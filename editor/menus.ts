/**
 * The commands of the editor as menus: the menus of the bar (File, Edit, View, Arrange, Help), of
 * the Export button and the zoom, and the menu of a right click. One table per menu, so a command
 * reads the same wherever it is offered.
 */

import type { Point } from "../src/scene.ts";
import type { Connection, Word } from "../src/tam.ts";
import type { ElementKind } from "../src/tam-edit.ts";
import type { Editor } from "./editor.ts";
import type { Arrangement } from "./guides.ts";
import type { IconName } from "./icons.ts";
import type { MenuEntry, MenuItem } from "./menu.ts";
import { kindName, TYPES, typeInfo } from "./types.ts";

/** How the page follows light and dark: one of them, or the system's choice. */
export type ThemeChoice = "light" | "dark" | "system";

/** What the page offers the panels: files, the theme and what is remembered across visits. */
export interface Shell {
  openFile(): void;
  saveFile(): void;
  exportSvg(): void;
  exportPng(): void;
  copySource(): void;
  /**
   * Shows another diagram in place of the current one, as a step that can be undone. Asks first
   * when there are unsaved changes, unless `sure` says the user was asked already.
   */
  replace(source: string, sure?: boolean): void;
  /** Whether the diagram changed since it was saved or opened. */
  readonly unsaved: boolean;
  readonly theme: ThemeChoice;
  setTheme(theme: ThemeChoice): void;
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
  /** Lays the whole diagram out automatically, and says so. */
  autoLayout(): void;
  shows(panel: PanelName): boolean;
  toggle(panel: PanelName): void;
  toggleSnap(): void;
  toggleGrid(): void;
}

/** The kinds of connection the editor offers: a word, and for dependencies their keyword. */
export const WIRES: { value: string; name: string; word: Word; keyword?: string }[] = [
  { value: "calls", name: "Request (calls)", word: "calls" },
  { value: "sends data", name: "Data flow (sends data)", word: "sends data" },
  { value: "---", name: "Channel, no direction", word: "---" },
  { value: "reads", name: "Read access", word: "reads" },
  { value: "writes", name: "Write access", word: "writes" },
  { value: "reads/writes", name: "Read and write access", word: "reads/writes" },
  { value: "requires", name: "Requires an interface", word: "requires" },
  { value: "delegates", name: "Delegates to a part", word: "delegates" },
  ...["use", "import", "create", "generate", "pointer"].map((keyword) => ({
    value: `dependency:${keyword}`,
    name: `Dependency «${keyword}»`,
    word: "dependency" as Word,
    keyword,
  })),
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
  ["agent", "Ctrl+G"],
  ["storage", ""],
  ["component", ""],
  ["subsystem", ""],
  ["package", ""],
  ["group", "Ctrl+Shift+G"],
];

const ELEMENTS: ElementKind[] = TYPES[0].palette.flatMap((group) =>
  group.items.map((item) => item.kind),
);

export class Menus {
  private readonly editor: Editor;
  private readonly shell: Shell;
  private readonly bench: Bench;

  constructor(editor: Editor, shell: Shell, bench: Bench) {
    this.editor = editor;
    this.shell = shell;
    this.bench = bench;
  }

  /** The menus of the bar, in their order. A diagram edited as text has nothing to arrange. */
  bar(): { name: string; items: () => MenuEntry[] }[] {
    return [
      { name: "File", items: () => this.file() },
      { name: "Edit", items: () => this.edit() },
      { name: "View", items: () => this.view() },
      ...(this.editor.editable ? [{ name: "Arrange", items: () => this.arrange() }] : []),
      { name: "Help", items: () => this.help() },
    ];
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
      current = this.editor.type;
    return [
      { name: "New…", key: "Ctrl+Alt+N", run: () => bench.chooser() },
      { name: "Open…", key: "Ctrl+O", run: () => shell.openFile() },
      {
        name: "Open example",
        // The examples of the type on show come first.
        items: [...TYPES]
          .sort((a, b) => Number(b.type === current) - Number(a.type === current))
          .map((info) => ({
            name: info.name,
            items: info.examples.map(([name, source]) => ({
              name,
              run: () => shell.replace(source),
            })),
          })),
      },
      "line",
      { name: "Save", key: "Ctrl+S", run: () => shell.saveFile() },
      "line",
      ...this.exports(),
    ];
  }

  /** The ways out of the editor: pictures, and the source as text. */
  exports(): MenuEntry[] {
    const { shell } = this;
    return [
      { name: "Export SVG", run: () => shell.exportSvg() },
      { name: "Export PNG", run: () => shell.exportPng() },
      { name: "Copy source", run: () => shell.copySource() },
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
      // Copies stand at a place: only a diagram that places its elements has them.
      placed = editor.editable ? text : "Elements of this diagram are not copied",
      needs = placed ?? (elements.length ? undefined : "Select an element"),
      [only] = editor.selection;
    return [
      { name: "Undo", key: "Ctrl+Z", off: !doc.canUndo, run: () => doc.undo() },
      { name: "Redo", key: "Ctrl+Shift+Z", off: !doc.canRedo, run: () => doc.redo() },
      "line",
      { name: "Cut", key: "Ctrl+X", off: needs, run: () => this.clip(true) },
      { name: "Copy", key: "Ctrl+C", off: needs, run: () => this.clip(false) },
      { name: "Paste", key: "Ctrl+V", off: placed, run: () => this.paste() },
      { name: "Duplicate", key: "Ctrl+D", off: needs, run: () => editor.duplicateSelection() },
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
      ...[50, 100, 200].map((percent) => ({
        name: `${percent}%`,
        key: percent === 100 ? "Ctrl+0" : undefined,
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
      { name: "Zoom in", key: "+", run: () => editor.view.zoomBy(1.25) },
      { name: "Zoom out", key: "−", run: () => editor.view.zoomBy(0.8) },
      { name: "100%", key: "Ctrl+0", run: () => editor.view.zoomTo(1) },
      { name: "Fit diagram", key: "1", run: () => editor.fit() },
      {
        name: "Fit selection",
        key: "2",
        off: editor.selectedElements.length ? undefined : "Select an element",
        run: () => editor.fitSelection(),
      },
      "line",
      { name: "Snap", checked: editor.snapping, run: () => bench.toggleSnap() },
      { name: "Grid", checked: editor.view.grid, run: () => bench.toggleGrid() },
      "line",
      panel("Shapes panel", "shapes"),
      panel("Outline panel", "outline"),
      panel("Properties", "properties"),
      panel("Source", "source"),
      "line",
      {
        name: "Theme",
        items: [theme("Light", "light"), theme("Dark", "dark"), theme("System", "system")],
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
        run: () => editor.wrapSelection(kind),
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
      "line",
      ...this.layouts(),
    ];
  }

  help(): MenuEntry[] {
    const { bench } = this;
    return [
      { name: "Keyboard and mouse", key: "?", run: () => bench.help() },
      { name: "TAM syntax", run: () => bench.syntax() },
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
    if (editor.structural) {
      // An activity diagram: a node is named, continued and removed; the layout is not the user's.
      const [id] = editor.selection.map((part) => part.id),
        node = elements.length === 1 && !wires.length;
      if (!editor.selection.length)
        return [{ name: "Add a step", run: () => editor.addPiece("step") }, "line", ...fits];
      const entries: MenuEntry[] = node
        ? [
            { name: "Rename", key: "F2", run: () => editor.rename(id) },
            { name: "Add a step after", run: () => editor.addPiece("step", id) },
            { name: "Add a decision after", run: () => editor.addPiece("decision", id) },
            "line",
          ]
        : [];
      return [...entries, remove];
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
        ? WIRES.filter((kind) => kind.value === current || editor.allowsWire(id, wireChange(kind)))
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
