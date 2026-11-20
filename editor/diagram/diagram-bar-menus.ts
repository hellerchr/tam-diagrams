// The diagram editor's menu bar (DiagramBar.svelte), as tam-diagrams' editor had it (menus.ts): File, Edit, View,
// Arrange and Help, each a function that builds the menu's rows when it opens, from what the window shows then. A row
// that does not apply stays, off, with the reason as its tooltip. The file commands are harness's own: Open is Find
// files, Save saves the buffer; the examples load with import() the first time the File menu is near.
import type { Example } from "../../src/examples.ts";
import { commands } from "../lib/commands.svelte.ts";
import { hintOf } from "../lib/hotkeys.svelte.ts";
import { type MenuEntry, toast } from "../lib/overlays.svelte.ts";
import { keys, plussed, viewMenu } from "./diagram-bar-view.ts";
import { arrangeMenu } from "./diagram-menus.ts";
import type { DiagramKind } from "./diagram-types.ts";
import type { Workbench } from "./diagram-workbench.svelte.ts";

/** A menu of the bar: its title, its rows, and why it is off when it does not apply. */
export type BarMenu = { title: string; off?: string; items: () => MenuEntry[] };

/** What the menus reach beyond the Workbench: the buffer's history and the guide sheet. */
export type BarHost = {
  ws: Workbench;
  canUndo?: boolean;
  canRedo?: boolean;
  onguide?: (page?: "all") => void;
};

/** The keys of one of harness's commands, written for a menu row. */
const keysOf = (id: string) => plussed(hintOf(id));

/** The guides' names, by the kind of diagram (old reference.ts). */
const GUIDES: Record<DiagramKind, string> = {
  tam: "TAM block diagram",
  class: "Class diagram",
  usecase: "Use case diagram",
  flowchart: "Activity diagram",
  swimlane: "Activity diagram",
  state: "State machine diagram",
  sequence: "Sequence diagram",
  er: "Entity relationship diagram",
};

/** The kinds draw.io takes (src/tam/drawio.ts DrawioKind, not imported: it is its own chunk). */
const DRAWIO = new Set<DiagramKind>(["tam", "flowchart", "swimlane", "state", "sequence"]);

let examples: Record<string, Example[]> | undefined;
/** Loads the examples (53 KB of data) for File > Open example, once. */
export function warmExamples() {
  if (!examples)
    void import("../../src/examples.ts").then((module) => (examples = module.EXAMPLES));
}

/** Runs one of harness's commands (lib/commands.svelte.ts) by its id. */
const runCommand = (id: string) =>
  commands()
    .find((c) => c.id === id)
    ?.run();

/** The diagram's types in plural, as the reasons say them. */
const plural = (ws: Workbench) => `${ws.current?.name ?? "Diagram"}s`;

/** Why the canvas has no commands: the diagram is edited as text. */
export const asText = (ws: Workbench) =>
  ws.textual ? `${plural(ws)} are edited as text` : undefined;

/** Why there is nothing to save, copy or draw: the diagram is empty (or does not read). */
function nothing(ws: Workbench): string | undefined {
  if (ws.empty) return "The diagram is empty";
  if (!ws.picture) return "The source has an error";
  return ws.picture.scene.shapes.length || ws.problem
    ? undefined
    : "The diagram is empty: there is nothing to draw";
}

/** What was copied here last, for a paste the browser does not give the clipboard to. */
let copied: string | undefined;

/** Puts the selected elements on the clipboard, and removes them when they are cut. */
function clip(ws: Workbench, cut: boolean) {
  const text = ws.ed.copy();
  if (text === undefined) return;
  copied = text;
  navigator.clipboard?.writeText(text).catch(() => {});
  if (cut) ws.ed.remove();
}

/** Pastes from the clipboard, or what was copied here when the browser does not give it. */
function paste(ws: Workbench) {
  void (navigator.clipboard?.readText() ?? Promise.reject(new Error("No clipboard")))
    .catch(() => copied ?? "")
    .then((text) => text && ws.ed.paste(text));
}

function copySource(ws: Workbench) {
  navigator.clipboard.writeText(ws.source).then(
    () => toast("Source copied."),
    () => toast("The browser did not allow copying.", "error"),
  );
}

/** The examples of every type the file may hold, the type on show first, each a submenu. */
function exampleItems(ws: Workbench): MenuEntry[] {
  const loaded = examples;
  if (!loaded) return [{ label: "Loading the examples…", off: true, action: () => {} }];
  const types = ws.types.toSorted((a, b) => Number(b === ws.current) - Number(a === ws.current));
  const kinds = new Set<string>();
  return types.flatMap((type) => {
    const kind = type.kind === "swimlane" ? "flowchart" : type.kind;
    if (kinds.has(kind) || !loaded[kind]?.length) return [];
    kinds.add(kind);
    return [
      {
        label: type.name,
        items: loaded[kind].map(([name, source]) => ({
          label: name,
          action: () => ws.replace(source),
        })),
      },
    ];
  });
}

/** The ways out of the editor: pictures, and the source as text (File, and the bar's Export button). */
export function exportItems(ws: Workbench): MenuEntry[] {
  const none = nothing(ws);
  const kind = ws.current?.kind;
  return [
    { label: "Export SVG…", off: none, action: () => ws.exportPicture("svg") },
    { label: "Export PNG…", off: none, action: () => ws.exportPicture("png") },
    {
      label: "Export draw.io",
      off:
        none ??
        (kind && DRAWIO.has(kind) ? undefined : `${plural(ws)} are not exported to draw.io`),
      action: () => ws.exportPicture("drawio"),
    },
    {
      label: "Copy source",
      off: ws.empty ? "The diagram is empty" : undefined,
      action: () => copySource(ws),
    },
  ];
}

function fileMenu(ws: Workbench): MenuEntry[] {
  warmExamples();
  return [
    { label: "New…", hint: keys("Mod-Alt-n"), action: ws.newDiagram },
    { label: "Open…", hint: keysOf("find-files"), action: () => runCommand("find-files") },
    { label: "Open example", items: exampleItems(ws) },
    "separator",
    {
      label: "Save",
      hint: keysOf("editor.save"),
      off: ws.empty ? "The diagram is empty" : undefined,
      action: ws.save,
    },
    "separator",
    ...exportItems(ws),
  ];
}

/** Why the selection is not renamed: it is not one element. */
function renameRefusal(ws: Workbench) {
  const [only, other] = ws.ed.selection;
  return only?.type === "element" && !other ? undefined : "Select one element";
}

function editMenu({ ws, canUndo, canRedo }: BarHost): MenuEntry[] {
  const { ed } = ws;
  const text = asText(ws);
  // The clipboard takes elements that stand at a place: only a block diagram has them.
  const placed =
    ws.model && !ed.uml
      ? text
      : (text ?? "Parts of this diagram are not copied between diagrams yet");
  const needs = placed ?? (ed.selectedIds().length ? undefined : "Select an element");
  const one = ed.selectedIds().length === 1 ? undefined : "Select one part that is not a group";
  return [
    {
      label: "Undo",
      hint: keys("Mod-z"),
      off: canUndo ? undefined : "There is nothing to undo",
      action: ws.undo,
    },
    {
      label: "Redo",
      hint: keys("Mod-Shift-z"),
      off: canRedo ? undefined : "There is nothing to redo",
      action: ws.redo,
    },
    "separator",
    { label: "Cut", hint: keys("Mod-x"), off: needs, action: () => clip(ws, true) },
    { label: "Copy", hint: keys("Mod-c"), off: needs, action: () => clip(ws, false) },
    { label: "Paste", hint: keys("Mod-v"), off: placed, action: () => paste(ws) },
    {
      label: "Duplicate",
      hint: keys("Mod-d"),
      off: ed.uml && !text ? one : needs,
      action: ed.duplicate,
    },
    {
      label: "Delete",
      hint: "Del",
      off: text ?? (ed.selection.length ? undefined : "Nothing is selected"),
      action: ed.remove,
    },
    "separator",
    { label: "Select all", hint: keys("Mod-a"), off: text, action: ed.selectAll },
    {
      label: "Rename",
      hint: "F2",
      off: text ?? renameRefusal(ws),
      action: () => ws.startRename(ed.selection[0]),
    },
  ];
}

function helpMenu({ ws, onguide }: BarHost): MenuEntry[] {
  const type = ws.current;
  return [
    { label: "Keyboard and mouse", hint: "?", action: ws.toggleHelp },
    {
      label: !type || type.kind === "tam" ? "TAM syntax" : `${type.name} syntax`,
      action: ws.showSyntax,
    },
    {
      label: `${type ? GUIDES[type.kind] : "Diagram"} guide`,
      hint: "F1",
      action: () => onguide?.(),
    },
    { label: "All guides", action: () => onguide?.("all") },
    "separator",
    { label: "All commands…", hint: keysOf("palette"), action: () => runCommand("palette") },
  ];
}

/** The bar's menus, in their order. Arrange is off in a diagram that is edited as text. */
export function barMenus(host: BarHost): BarMenu[] {
  const { ws } = host;
  return [
    { title: "File", items: () => fileMenu(ws) },
    { title: "Edit", items: () => editMenu(host) },
    { title: "View", items: () => viewMenu(ws) },
    { title: "Arrange", off: asText(ws), items: () => arrangeMenu(ws) },
    { title: "Help", items: () => helpMenu(host) },
  ];
}
