/**
 * The commands of the editor as menus: the menus of the bar (File, Edit, View, Arrange, Help), of
 * the Export button and the zoom, and the menu of a right click. One table per menu, so a command
 * reads the same wherever it is offered.
 */

import { exportsToDrawio } from "../src/drawio.ts";
import type { Point } from "../src/scene.ts";
import type { Connection, Word } from "../src/tam.ts";
import type { ElementKind } from "../src/tam-edit.ts";
import type { Editor } from "./editor.ts";
import type { Arrangement } from "./guides.ts";
import type { IconName } from "./icons.ts";
import { ageOf, type Recent } from "./files.ts";
import { type MenuEntry, type MenuItem, refusal } from "./menu.ts";
import { GUIDES, guideOf } from "./reference.ts";
import { type DiagramType, kindName, sameType, TYPES, typeInfo, typeOf } from "./types.ts";

/** How the page follows light and dark: one of them, or the system's choice. */
export type ThemeChoice = "light" | "dark" | "system";

/** What the page offers the panels: files, the theme and what is remembered across visits. */
export interface Shell {
  openFile(): void;
  /** Saves to the file the diagram was opened from or saved to last; asks for one when there is none. */
  saveFile(): void;
  /** Saves to a file the user names. */
  saveFileAs(): void;
  /** Opens the export dialog for a picture of the diagram. */
  exportPicture(format: "svg" | "png"): void;
  /** Saves the diagram as a draw.io file, drawn with the TAM shapes of draw.io. */
  exportDrawio(): void;
  copySource(): void;
  /** The diagrams that were on show lately, the newest first, without the one on show. */
  recents(): Recent[];
  /**
   * Shows another diagram in place of the current one, as a step that can be undone. Asks first
   * when there are unsaved changes, unless `sure` says the user was asked already.
   */
  replace(source: string, sure?: boolean): void;
  /** Whether the diagram changed since it was saved or opened. */
  readonly unsaved: boolean;
  /** The name of the file the diagram was opened from or saved to; undefined while it has none. */
  readonly fileName: string | undefined;
  readonly theme: ThemeChoice;
  setTheme(theme: ThemeChoice): void;
  /** Whether connections bend round at their corners, in the picture and what is exported. */
  readonly rounded: boolean;
  setRounded(rounded: boolean): void;
  /** Remembers a choice across visits. */
  remember(key: string, value: string): void;
  recall(key: string): string | null;
}

/** The parts of the window that show and hide. */
export type PanelName = "shapes" | "outline" | "properties" | "source";

/** What the menus ask of the panels around the canvas. */
export interface Bench {
  /** Opens the chooser of diagram types. */
  chooser(): void;
  help(): void;
  syntax(): void;
  /**
   * Opens the reference guide of a diagram type, or the list of all guides. Without a type it
   * opens the guide of the diagram on show, and closes that guide when it is open.
   */
  guide(page?: DiagramType | "all"): void;
  /** Opens the list of all commands, to pick one by typing. */
  commands(): void;
  readonly minimap: boolean;
  toggleMinimap(): void;
  /** Lays the whole diagram out automatically, and says so. */
  autoLayout(): void;
  shows(panel: PanelName): boolean;
  toggle(panel: PanelName): void;
  toggleSnap(): void;
  toggleGrid(): void;
}

/**
 * The kinds of connection the editor knows: a word, and for dependencies their keyword. Those of
 * the design level are shown for a connection of that kind and offered for no other.
 */
export const WIRES: {
  value: string;
  name: string;
  word: Word;
  keyword?: string;
  design?: boolean;
}[] = [
  { value: "calls", name: "Request (calls)", word: "calls" },
  { value: "sends data", name: "Data flow (sends data)", word: "sends data" },
  { value: "---", name: "Channel, no direction", word: "---" },
  { value: "reads", name: "Read access", word: "reads" },
  { value: "writes", name: "Write access", word: "writes" },
  { value: "reads/writes", name: "Read and write access", word: "reads/writes" },
  { value: "requires", name: "Requires an interface", word: "requires", design: true },
  { value: "delegates", name: "Delegates to a part", word: "delegates", design: true },
  ...["use", "import", "create", "generate", "pointer"].map((keyword) => ({
    value: `dependency:${keyword}`,
    name: `Dependency «${keyword}»`,
    word: "dependency" as Word,
    keyword,
    design: keyword === "use" || keyword === "import",
  })),
  { value: "anchor", name: "Attaches a note", word: "anchor" },
];

/** The change that makes a connection one of the kinds in `WIRES`. */
export const wireChange = (kind: (typeof WIRES)[number]) => ({
  word: kind.word,
  ...(kind.keyword ? { label: kind.keyword } : {}),
});

/** The kind in `WIRES` a connection is. */
export const wireValue = (connection: Connection) =>
  connection.word === "dependency" ? `dependency:${connection.label}` : connection.word;

/** A way to arrange the selected elements: its icon, its name, and how many elements it needs. */
export interface ArrangeAction {
  icon: IconName;
  name: string;
  group: "Align" | "Distribute" | "Size";
  least: number;
  run(editor: Editor): void;
}

const align = (how: Arrangement, icon: IconName, name: string): ArrangeAction => ({
  icon,
  name,
  group: "Align",
  least: 2,
  run: (editor) => editor.arrange(how),
});

/** Aligning, distributing and sizing, in the order the inspector and the menus show them. */
export const ARRANGE: ArrangeAction[] = [
  align("left", "align-left", "Align left edges"),
  align("center", "align-center", "Align centers"),
  align("right", "align-right", "Align right edges"),
  align("top", "align-top", "Align top edges"),
  align("middle", "align-middle", "Align middles"),
  align("bottom", "align-bottom", "Align bottom edges"),
  {
    icon: "spread-x",
    name: "Distribute left to right",
    group: "Distribute",
    least: 3,
    run: (editor) => editor.arrange("spread-x"),
  },
  {
    icon: "spread-y",
    name: "Distribute top to bottom",
    group: "Distribute",
    least: 3,
    run: (editor) => editor.arrange("spread-y"),
  },
  {
    icon: "same-width",
    name: "Same width",
    group: "Size",
    least: 2,
    run: (editor) => editor.sameSize("width"),
  },
  {
    icon: "same-height",
    name: "Same height",
    group: "Size",
    least: 2,
    run: (editor) => editor.sameSize("height"),
  },
  {
    icon: "fit-size",
    name: "Fit size to the contents",
    group: "Size",
    least: 1,
    run: (editor) => editor.fitSize(),
  },
];

/** Why an arrangement is not offered for a number of selected elements; undefined when it is. */
export const arrangeRefusal = (action: ArrangeAction, selected: number) =>
  selected >= action.least
    ? undefined
    : action.least === 1
      ? "Select an element"
      : `Select ${action.least === 2 ? "two" : "three"} or more elements`;

/** The boxes a selection may be put in, with the keys that do so. */
const BOXES: [ElementKind, string][] = [
  ["agent", ""],
  ["storage", ""],
  ["group", "Ctrl+G"],
];

const ELEMENTS: ElementKind[] = TYPES[0].palette.flatMap((group) =>
  group.items.map((item) => item.kind),
);

/** A menu of the bar: its name, its rows, and why it is off when it does not apply. */
export interface BarMenu {
  name: string;
  items: () => MenuEntry[];
  off?: string;
}

/** A command as the list of all commands shows it: its name, the menus that lead to it, and its keys. */
export interface Command {
  name: string;
  /** The menus it stands in, as "File ▸ Open example". */
  path: string;
  key?: string;
  off?: string | boolean;
  run(): void;
}

/** The zooms the menus offer, in percent. */
const ZOOMS = [25, 50, 75, 100, 150, 200, 400];

export class Menus {
  private readonly editor: Editor;
  private readonly shell: Shell;
  private readonly bench: Bench;

  constructor(editor: Editor, shell: Shell, bench: Bench) {
    this.editor = editor;
    this.shell = shell;
    this.bench = bench;
  }

  /** The menus of the bar, in their order. Arrange is off in a diagram that is edited as text. */
  bar(): BarMenu[] {
    const { editor } = this,
      info = typeInfo(editor.type);
    return [
      { name: "File", items: () => this.file() },
      { name: "Edit", items: () => this.edit() },
      { name: "View", items: () => this.view() },
      {
        name: "Arrange",
        items: () => this.arrange(),
        off: editor.editable || editor.structural ? undefined : `${info.plural} are edited as text`,
      },
      { name: "Help", items: () => this.help() },
    ];
  }

  /**
   * Every command in one list: those of the bar's menus, each with the menus that lead to it, and
   * what has no menu: the pointer tools, the shapes of the diagram type and the zooms.
   */
  commands(): Command[] {
    const { editor, bench } = this,
      info = typeInfo(editor.type),
      stuck = editor.doc.problem ? "Fix the error in the source first" : undefined;
    const tools: Command[] = [
      { name: "Select tool", path: "Tools", key: "V", run: () => editor.setTool("select") },
      { name: "Pan tool", path: "Tools", key: "H", run: () => editor.setTool("pan") },
      { name: "Connect tool", path: "Tools", key: "C", run: () => editor.setTool("connect") },
    ];
    // A piece of a structure is added at the selected part; a block shape is picked, to place with a click.
    const shapes: Command[] = editor.structure
      ? editor.structure.pieces.map((piece) => ({
          name: `Add ${piece.name.toLowerCase()}`,
          path: "Shapes",
          off: stuck ?? editor.pieceRefusal(piece.kind),
          run: () => editor.addPiece(piece.kind),
        }))
      : info.palette.flatMap((group) =>
          group.items.map((shape) => ({
            name: `Add ${shape.name.toLowerCase()}`,
            path: "Shapes",
            key: shape.key,
            off:
              stuck ??
              (editor.allowsKind(shape.kind)
                ? undefined
                : "The level of this diagram does not take this shape"),
            run: () => editor.setTool(shape.kind),
          })),
        );
    const zooms: Command[] = ZOOMS.filter((percent) => percent !== 100).map((percent) => ({
      name: `Zoom to ${percent}%`,
      path: "View",
      run: () => editor.view.zoomTo(percent / 100),
    }));
    const guides: Command[] = GUIDES.map((guide) => ({
      name: `Guide: ${guide.name}`,
      path: "Help",
      run: () => bench.guide(guide.type),
    }));
    return [...this.menuCommands(), ...guides, ...tools, ...shapes, ...zooms];
  }

  /** Every command of the bar's menus, each with the menus that lead to it. */
  private menuCommands(): Command[] {
    const walk = (entries: MenuEntry[], path: string, off?: string | boolean): Command[] =>
      entries.flatMap((entry): Command[] => {
        if (!entry || entry === "line") return [];
        const reason = off || refusal(entry);
        if (entry.items) return walk(entry.items, `${path} ▸ ${entry.name}`, reason);
        const run = entry.run;
        return run ? [{ name: entry.name, path, key: entry.key, off: reason, run }] : [];
      });
    return this.bar().flatMap((menu) => walk(menu.items(), menu.name, menu.off));
  }

  /** Why there is nothing to save or to draw: the diagram is empty. Undefined when there is. */
  private get nothing(): string | undefined {
    const { doc } = this.editor;
    if (!doc.source.trim()) return "The diagram is empty";
    return doc.picture && !doc.picture.scene.shapes.length && !doc.problem
      ? "The diagram is empty: there is nothing to draw"
      : undefined;
  }

  /** Puts the selected elements on the clipboard, and removes them when they are cut. */
  private clip(cut: boolean) {
    const text = this.editor.copy();
    if (text === undefined) return;
    void navigator.clipboard?.writeText(text).catch(() => {});
    if (cut) this.editor.deleteSelection();
  }

  /** Pastes from the clipboard, or what was copied here when the browser does not give it. */
  private paste() {
    const { editor } = this;
    void (navigator.clipboard?.readText() ?? Promise.reject(new Error("No clipboard.")))
      .catch(() => editor.copiedText ?? "")
      .then((text) => text && editor.paste(text));
  }

  file(): MenuEntry[] {
    const { shell, bench } = this,
      current = this.editor.type,
      recents = shell.recents();
    return [
      { name: "New…", key: "Ctrl+Alt+N", run: () => bench.chooser() },
      { name: "Open…", key: "Ctrl+O", run: () => shell.openFile() },
      {
        name: "Open recent",
        off: recents.length ? undefined : "No other diagram was on show lately",
        items: recents.map(({ title, source, at }) => ({
          name: title,
          icon: typeInfo(typeOf(source)).icon,
          note: ageOf(at),
          run: () => shell.replace(source),
        })),
      },
      {
        name: "Open example",
        // The examples of the type on show come first.
        items: [...TYPES]
          .sort((a, b) => Number(sameType(b.type, current)) - Number(sameType(a.type, current)))
          .map((info) => ({
            name: info.name,
            items: info.examples.map(([name, source]) => ({
              name,
              run: () => shell.replace(source),
            })),
          })),
      },
      "line",
      {
        name: "Save",
        key: "Ctrl+S",
        off: this.editor.doc.source.trim() ? undefined : "The diagram is empty",
        run: () => shell.saveFile(),
      },
      {
        name: "Save as…",
        key: "Ctrl+Shift+S",
        off: this.editor.doc.source.trim() ? undefined : "The diagram is empty",
        run: () => shell.saveFileAs(),
      },
      "line",
      ...this.exports(),
    ];
  }

  /** The ways out of the editor: pictures, and the source as text. */
  exports(): MenuEntry[] {
    const { shell, nothing } = this;
    return [
      { name: "Export SVG…", off: nothing, run: () => shell.exportPicture("svg") },
      { name: "Export PNG…", off: nothing, run: () => shell.exportPicture("png") },
      {
        name: "Export draw.io",
        off:
          nothing ??
          (exportsToDrawio(this.editor.doc.source)
            ? undefined
            : `${typeInfo(this.editor.type).plural} are not exported to draw.io`),
        run: () => shell.exportDrawio(),
      },
      {
        name: "Copy source",
        off: this.editor.doc.source.trim() ? undefined : "The diagram is empty",
        run: () => shell.copySource(),
      },
    ];
  }

  edit(): MenuEntry[] {
    const { editor } = this,
      { doc } = editor,
      elements = editor.selectedElements,
      text =
        editor.editable || editor.structural
          ? undefined
          : `${typeInfo(editor.type).plural} are edited as text`,
      // The clipboard takes elements that stand at a place: only a block diagram has them.
      placed = editor.editable ? text : "Parts of this diagram are not copied between diagrams yet",
      needs = placed ?? (elements.length ? undefined : "Select an element"),
      // A part of a structure is copied in place, where its type has copies.
      copies = editor.structural
        ? !editor.can("copy")
          ? `Parts of ${typeInfo(editor.type).plural.toLowerCase()} are not duplicated`
          : elements.length === 1 && !editor.doc.picture?.parts?.get(elements[0])?.group
            ? undefined
            : "Select one part that is not a group"
        : needs,
      [only] = editor.selection;
    return [
      {
        name: "Undo",
        key: "Ctrl+Z",
        off: doc.canUndo ? undefined : "There is nothing to undo",
        run: () => doc.undo(),
      },
      {
        name: "Redo",
        key: "Ctrl+Shift+Z",
        off: doc.canRedo ? undefined : "There is nothing to redo",
        run: () => doc.redo(),
      },
      "line",
      { name: "Cut", key: "Ctrl+X", off: needs, run: () => this.clip(true) },
      { name: "Copy", key: "Ctrl+C", off: needs, run: () => this.clip(false) },
      { name: "Paste", key: "Ctrl+V", off: placed, run: () => this.paste() },
      { name: "Duplicate", key: "Ctrl+D", off: copies, run: () => editor.duplicateSelection() },
      {
        name: "Delete",
        key: "Del",
        off: text ?? (editor.selection.length ? undefined : "Nothing is selected"),
        run: () => editor.deleteSelection(),
      },
      "line",
      { name: "Select all", key: "Ctrl+A", off: text, run: () => editor.selectAll() },
      {
        name: "Rename",
        key: "F2",
        off:
          text ??
          (editor.selection.length === 1 && only.type === "element"
            ? undefined
            : "Select one element"),
        run: () => editor.rename(only.id),
      },
    ];
  }

  /** The zoom steps and fits, for the View menu and the zoom in the status bar. */
  zoom(): MenuEntry[] {
    const { editor } = this;
    return [
      ...ZOOMS.map((percent) => ({
        name: `${percent}%`,
        key: percent === 100 ? "Ctrl+0" : undefined,
        checked: Math.round(editor.view.zoom * 100) === percent,
        run: () => editor.view.zoomTo(percent / 100),
      })),
      "line",
      { name: "Fit diagram", key: "1", run: () => editor.fit() },
      {
        name: "Fit selection",
        key: "2",
        off: editor.selectedElements.length ? undefined : "Select an element",
        run: () => editor.fitSelection(),
      },
    ];
  }

  view(): MenuEntry[] {
    const { editor, shell, bench } = this;
    const panel = (name: string, which: Parameters<Bench["shows"]>[0]): MenuItem => ({
      name,
      checked: bench.shows(which),
      run: () => bench.toggle(which),
    });
    const theme = (name: string, choice: ThemeChoice): MenuItem => ({
      name,
      checked: shell.theme === choice,
      run: () => shell.setTheme(choice),
    });
    return [
      { name: "Zoom in", key: "+", run: () => editor.view.zoomStep(1) },
      { name: "Zoom out", key: "−", run: () => editor.view.zoomStep(-1) },
      { name: "100%", key: "Ctrl+0", run: () => editor.view.zoomTo(1) },
      { name: "Fit diagram", key: "1", run: () => editor.fit() },
      {
        name: "Fit selection",
        key: "2",
        off: editor.selectedElements.length ? undefined : "Select an element",
        run: () => editor.fitSelection(),
      },
      "line",
      // Only elements placed by hand snap to anything.
      (editor.editable || editor.structural) && {
        name: "Snap",
        checked: editor.snapping,
        run: () => bench.toggleSnap(),
      },
      { name: "Grid", checked: editor.view.grid, run: () => bench.toggleGrid() },
      { name: "Minimap", checked: bench.minimap, run: () => bench.toggleMinimap() },
      "line",
      panel("Shapes", "shapes"),
      panel("Outline", "outline"),
      panel("Properties", "properties"),
      panel("Source", "source"),
      "line",
      {
        name: "Theme",
        items: [theme("Light", "light"), theme("Dark", "dark"), theme("System", "system")],
      },
      {
        name: "Rounded connectors",
        checked: shell.rounded,
        run: () => shell.setRounded(!shell.rounded),
      },
    ];
  }

  /** Aligning, distributing and sizing as menu rows, each off with its reason when too little is selected. */
  private arrangements(): { align: MenuItem[]; distribute: MenuItem[]; size: MenuItem[] } {
    const { editor } = this,
      selected = editor.selectedElements.length;
    const rows = (group: ArrangeAction["group"]) =>
      ARRANGE.filter((action) => action.group === group).map((action): MenuItem => ({
        name: action.name,
        off: arrangeRefusal(action, selected),
        run: () => action.run(editor),
      }));
    return { align: rows("Align"), distribute: rows("Distribute"), size: rows("Size") };
  }

  /** Putting the selection in a new box: only the boxes that may hold it. */
  private boxes(): MenuItem {
    const { editor } = this,
      kinds = BOXES.filter(([kind]) => editor.allowsWrap(kind));
    return {
      name: "Put in",
      off: kinds.length
        ? undefined
        : editor.selectedElements.length
          ? "No box may hold what is selected"
          : "Select the elements to put in a box",
      items: kinds.map(([kind, key]) => ({
        name: kindName(kind),
        key: key || undefined,
        // A group of one group, or of the parts of one, groups nothing.
        off: kind === "group" ? editor.groupedAlready : undefined,
        run: () => (kind === "group" ? editor.groupSelection() : editor.wrapSelection(kind)),
      })),
    };
  }

  /** Laying out automatically: what is selected, and the whole diagram. */
  private layouts(): MenuItem[] {
    const { editor, bench } = this,
      { picture } = editor.doc,
      placed = !!picture?.placed && picture.diagram.nodes.size > 0;
    return [
      {
        name: editor.selectedElements.length === 1 ? "Auto layout inside" : "Auto layout these",
        off: editor.canLayoutSelection
          ? undefined
          : "Select an element that holds others, or several elements",
        run: () => void editor.layoutSelection(),
      },
      {
        name: "Auto layout",
        off: placed ? undefined : "The layout is automatic already",
        run: () => bench.autoLayout(),
      },
    ];
  }

  arrange(): MenuEntry[] {
    const { editor } = this,
      { align, distribute, size } = this.arrangements();
    return [
      { name: "Align", items: align },
      { name: "Distribute", items: distribute },
      ...size,
      "line",
      this.boxes(),
      {
        name: "Take out of its box",
        off: editor.selectionHolder ? undefined : "Select elements that stand in a box",
        run: () => editor.takeOut(),
      },
      {
        name: "Ungroup",
        key: "Ctrl+Shift+G",
        off: editor.ungroupable ? undefined : "Select one element that holds others",
        run: () => editor.ungroupSelection(),
      },
      "line",
      ...this.layouts(),
    ];
  }

  /** The two ways a block diagram is laid out, as a choice: by hand, or automatically. */
  layoutMode(): MenuEntry[] {
    const { editor, bench } = this,
      { picture } = editor.doc,
      placed = !!picture?.placed && picture.diagram.nodes.size > 0;
    return [
      {
        name: "Manual positions",
        checked: placed,
        off: placed
          ? undefined
          : "Move an element: every element then stands where the source says",
        run: () => {},
      },
      {
        name: "Auto layout",
        checked: !placed,
        run: () => {
          if (placed) bench.autoLayout();
        },
      },
    ];
  }

  help(): MenuEntry[] {
    const { bench, editor } = this,
      info = typeInfo(editor.type);
    return [
      { name: "Keyboard and mouse", key: "?", run: () => bench.help() },
      {
        name: info.type === "tam" ? "TAM syntax" : `${info.name} syntax`,
        run: () => bench.syntax(),
      },
      {
        name: `${guideOf(info.type)?.name ?? info.name} guide`,
        key: "F1",
        run: () => bench.guide(),
      },
      { name: "All guides", run: () => bench.guide("all") },
      "line",
      { name: "All commands…", key: "Ctrl+K", run: () => bench.commands() },
    ];
  }

  /** The menu of a right click: what can be done with the selection, or at the point on the empty canvas. */
  context(point: Point): MenuEntry[] {
    const { editor } = this,
      elements = editor.selectedElements,
      wires = editor.selectedWires;
    const remove: MenuItem = {
      name: "Delete",
      key: "Del",
      danger: true,
      run: () => editor.deleteSelection(),
    };
    const fits: MenuEntry[] = [
      { name: "Fit diagram", key: "1", run: () => editor.fit() },
      { name: "100%", key: "Ctrl+0", run: () => editor.view.zoomTo(1) },
    ];
    const { structure } = editor;
    if (structure) {
      // A diagram that lays itself out: a part is named, continued and removed, a join changes its kind.
      const [id] = editor.selection.map((part) => part.id),
        pieces = (at?: string | null): MenuEntry[] =>
          structure.pieces.map((piece) => ({
            name: piece.name,
            off: editor.pieceRefusal(piece.kind),
            run: () => editor.addPiece(piece.kind, at),
          }));
      if (!editor.selection.length) return [{ name: "Add", items: pieces(null) }, "line", ...fits];
      const parts = editor.doc.picture?.parts,
        // The groups a part can be moved into, and out of all with the last row.
        groups = [...(parts?.values() ?? [])].filter((node) => node.group && node.id !== id);
      if (elements.length === 1 && !wires.length) {
        const part = parts?.get(id);
        return [
          editor.nameable(id) && { name: "Rename", key: "F2", run: () => editor.rename(id) },
          { name: "Add here", items: pieces(id) },
          editor.can("moveInto") &&
            !part?.group &&
            (groups.length > 0 || !!part?.parent) && {
              name: "Move to",
              items: [
                ...groups.map((group) => ({
                  name: group.label || group.id,
                  checked: part?.parent === group.id,
                  run: () => editor.moveElements([id], group.id),
                })),
                !!part?.parent && {
                  name: "Out of its group",
                  run: () => editor.moveElements([id], null),
                },
              ],
            },
          editor.can("copy") &&
            !part?.group && {
              name: "Duplicate",
              key: "Ctrl+D",
              run: () => editor.duplicateSelection(),
            },
          editor.can("ungroup") &&
            !!part?.group && {
              name: "Ungroup",
              key: "Ctrl+Shift+G",
              run: () => editor.ungroup(id),
            },
          "line",
          remove,
        ];
      }
      if (wires.length === 1 && !elements.length)
        return [
          !!editor.wireLabel(id) && {
            name: "Edit label",
            run: () => {
              const wire = editor.doc.picture?.scene.wires.find((item) => item.edge === id),
                middle = wire?.points[Math.floor(wire.points.length / 2)];
              if (middle) editor.rename(id, true, middle);
            },
          },
          editor.labelPlaced(id) && {
            name: "Put the label back",
            run: () => editor.unplaceLabel(id),
          },
          structure.links.length > 1 &&
            structure.links.some((link) => link.kind === editor.linkKind(id)) && {
              name: "Change kind",
              items: structure.links.map((link) => ({
                name: link.name,
                checked: editor.linkKind(id) === link.kind,
                run: () => editor.relink(id, link.kind),
              })),
            },
          editor.can("reverse") && { name: "Reverse", run: () => editor.reverseJoin(id) },
          editor.type === "sequence" && {
            name: "Move earlier",
            key: "↑",
            run: () => editor.shift(-1),
          },
          editor.type === "sequence" && {
            name: "Move later",
            key: "↓",
            run: () => editor.shift(1),
          },
          "line",
          remove,
        ];
      return [remove];
    }
    if (!editor.editable) return fits;
    if (elements.length && wires.length) return [remove];
    if (elements.length) {
      const [id] = elements,
        kind = elements.length === 1 ? editor.doc.picture?.diagram.nodes.get(id)?.kind : undefined,
        { align, distribute, size } = this.arrangements(),
        [inside] = this.layouts();
      return [
        elements.length === 1 && { name: "Rename", key: "F2", run: () => editor.rename(id) },
        {
          name: "Change kind",
          items: ELEMENTS.filter(
            (item) => item === kind || editor.allowsElements({ kind: item }),
          ).map((item) => ({
            name: kindName(item),
            checked: item === kind,
            run: () => editor.setElements({ kind: item }),
          })),
        },
        "line",
        this.boxes(),
        !!editor.selectionHolder && { name: "Take out of its box", run: () => editor.takeOut() },
        !!editor.ungroupable && {
          name: "Ungroup",
          key: "Ctrl+Shift+G",
          run: () => editor.ungroupSelection(),
        },
        { name: "Arrange", items: [...align, "line", ...distribute, "line", ...size] },
        editor.canLayoutSelection && inside,
        "line",
        { name: "Fit selection", key: "2", run: () => editor.fitSelection() },
        "line",
        { name: "Duplicate", key: "Ctrl+D", run: () => editor.duplicateSelection() },
        { name: "Copy", key: "Ctrl+C", run: () => this.clip(false) },
        { name: "Cut", key: "Ctrl+X", run: () => this.clip(true) },
        "line",
        remove,
      ];
    }
    if (wires.length) {
      const [id] = wires,
        connection = wires.length === 1 ? editor.connection(id) : undefined,
        current = connection && wireValue(connection);
      // The kinds this connection may be, between the elements it joins.
      const kinds = connection
        ? WIRES.filter(
            (kind) =>
              kind.value === current || (!kind.design && editor.allowsWire(id, wireChange(kind))),
          )
        : [];
      return [
        kinds.length > 1 && {
          name: "Change kind",
          items: kinds.map((kind) => ({
            name: kind.name,
            checked: kind.value === current,
            run: () => editor.setWire(id, wireChange(kind)),
          })),
        },
        !!connection &&
          editor.allowsWire(id, { reverse: true }) && {
            name: "Reverse",
            run: () => editor.setWire(id, { reverse: true }),
          },
        !!connection &&
          connection.word !== "dependency" && {
            name: connection.label ? "Edit label" : "Add a label",
            run: () => editor.rename(id, true, point),
          },
        editor.labelPlaced(id) && {
          name: "Put the label back",
          run: () => editor.unplaceLabel(id),
        },
        "line",
        remove,
      ];
    }
    const kinds = ELEMENTS.filter((kind) => editor.allowsKind(kind)),
      [, whole] = this.layouts();
    return [
      kinds.length > 0 && {
        name: "Add",
        items: kinds.map((kind) => ({
          name: kindName(kind),
          run: () => editor.create(kind, point),
        })),
      },
      "line",
      { name: "Paste", key: "Ctrl+V", run: () => this.paste() },
      { name: "Select all", key: "Ctrl+A", run: () => editor.selectAll() },
      "line",
      ...fits,
      "line",
      whole,
    ];
  }
}
