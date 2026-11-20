// The diagram editor's View menu (DiagramBar.svelte) and the status bar's menus (DiagramStatus.svelte): zooming,
// fitting, the switches of the canvas and the panels that show, and the two ways a diagram is laid out, as tam-diagrams'
// editor had them (menus.ts view, zoom, layoutMode).
import { isMac } from "../lib/hotkeys.svelte.ts";
import { prettyKeys } from "../lib/keyspec.ts";
import type { MenuAction, MenuEntry } from "../lib/overlays.svelte.ts";
import type { Workbench } from "./diagram-workbench.svelte.ts";

/** Keys as the old editor wrote them, "Ctrl+Shift+Z" (on a Mac, harness's symbols). */
export const plussed = (hint: string) => (isMac ? hint : hint.replaceAll(" ", "+"));
/** A keymap spec ("Mod-Shift-z") written for a menu row. */
export const keys = (spec: string) => plussed(prettyKeys(spec, isMac));

/** The zooms the menus offer, in percent. */
const ZOOMS = [25, 50, 75, 100, 150, 200, 400];

/** A panel of the window the View menu shows or hides. */
type Panel = "shapes" | "outline" | "properties" | "source";

/** Whether a panel shows: a tab of the left panel, or a section of the right one while that is open. */
function shows(ws: Workbench, panel: Panel): boolean {
  const { layout } = ws;
  return panel === "shapes" || panel === "outline"
    ? layout.left === panel
    : layout.side && layout[panel];
}

/** Shows or hides a panel; a section of the closed right panel opens it, with the section showing. */
function togglePanel(ws: Workbench, panel: Panel) {
  const { layout } = ws;
  if (panel === "shapes" || panel === "outline") return layout.toggleLeft(panel);
  if (!layout.side) {
    layout[panel] = true;
    layout.side = true;
  } else layout[panel] = !layout[panel];
}

const fitSelection = (ws: Workbench): MenuAction => ({
  label: "Fit selection",
  hint: "2",
  off: ws.ed.selectedIds().length ? undefined : "Select an element",
  action: ws.fitSelection,
});

/** The zoom steps and fits: the status bar's zoom menu. */
export function zoomItems(ws: Workbench): MenuEntry[] {
  const now = Math.round(ws.camera.view.zoom * 100);
  return [
    ...ZOOMS.map((percent) => ({
      label: `${percent}%`,
      hint: percent === 100 ? keys("Mod-0") : undefined,
      checked: now === percent,
      action: () => ws.zoomTo(percent / 100),
    })),
    "separator",
    { label: "Fit diagram", hint: "1", action: ws.fit },
    fitSelection(ws),
  ];
}

export function viewMenu(ws: Workbench): MenuEntry[] {
  const { layout } = ws;
  const panel = (label: string, which: Panel): MenuAction => ({
    label,
    checked: shows(ws, which),
    action: () => togglePanel(ws, which),
  });
  return [
    { label: "Zoom in", hint: "+", action: () => ws.zoomStep(true) },
    { label: "Zoom out", hint: "−", action: () => ws.zoomStep(false) },
    { label: "100%", hint: keys("Mod-0"), action: () => ws.zoomTo(1) },
    { label: "Fit diagram", hint: "1", action: ws.fit },
    fitSelection(ws),
    "separator",
    // Only elements placed by hand snap to anything.
    !!ws.model && {
      label: "Snap",
      checked: layout.snap,
      action: () => (layout.snap = !layout.snap),
    },
    { label: "Grid", checked: layout.grid, action: () => (layout.grid = !layout.grid) },
    { label: "Minimap", checked: layout.minimap, action: () => (layout.minimap = !layout.minimap) },
    { label: "Light canvas", checked: layout.light, action: () => (layout.light = !layout.light) },
    "separator",
    panel("Shapes", "shapes"),
    panel("Outline", "outline"),
    panel("Properties", "properties"),
    panel("Source", "source"),
  ];
}

/** The two ways a diagram on the canvas is laid out, as a choice: by hand (`placed`), or automatically. */
export function layoutItems(ws: Workbench, placed: boolean): MenuEntry[] {
  return [
    {
      label: "Manual positions",
      checked: placed,
      off: placed ? undefined : "Move an element: every element then stands where the source says",
      action: () => {},
    },
    { label: "Auto layout", checked: !placed, action: () => placed && ws.autoLayout() },
  ];
}
