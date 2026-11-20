// The Keyboard and mouse sheet of the diagram editor (DiagramHelp.svelte), as the old editor's dialogs.ts had it: what
// each key and gesture does, in groups, for a block diagram (placed by hand) or a UML type (it lays itself out). The
// keys of harness's window where they differ from the old editor's (Ctrl+P opens a file, Ctrl+K the palette).

/** A row of a sheet: the keys (shown as keycaps; Click, Drag and Wheel as words between them), a gesture said as a
 *  sentence, or code; and what it does. */
export type SheetRow = [how: string | string[], does: string];
/** A group of a sheet under its title. */
export type SheetGroup = [title: string, rows: SheetRow[]];

/** What the pointer does, which a sheet writes as words between the keys. */
export const GESTURES = new Set(["Click", "Drag", "Wheel"]);

/** Moving the view and working with files: the same in every diagram type. */
const VIEW_KEYS: SheetGroup = [
  "View and files",
  [
    ["Wheel", "Move the view; Space-drag and the middle button do too"],
    [["Shift", "Wheel"], "Move the view sideways"],
    [["Ctrl", "Wheel"], "Zoom; + and − do too, and the zoom in the status bar takes a number"],
    [["1"], "Fit the diagram"],
    [["2"], "Fit the selection"],
    [["Ctrl", "0"], "Zoom to 100%"],
    [["V", "H"], "Select tool, pan tool"],
    [["Ctrl", "S"], "Save"],
    [["Ctrl", "P"], "Open a file"],
    [["Ctrl", "Alt", "N"], "New diagram"],
    [["Ctrl", "K"], "Sessions and commands, to pick by typing"],
    [["Alt"], "The menu bar; F10 does too. With a letter, its menu: Alt+F for File"],
    [["F1"], "The guide of the diagram's type: its rules and its syntax"],
    [["Ctrl", "F"], "Find in the source, with the cursor there"],
  ],
];

/** What the keyboard and the mouse do in a block diagram, whose elements are placed by hand. */
const BLOCK_KEYS: SheetGroup[] = [
  [
    "Add and connect",
    [
      ["Drag a shape", "Add it where it is dropped"],
      [["A", "U", "S", "G", "N"], "Agent, human, storage, group, note: then click"],
      ["Double-click a shape", "Keep the tool to place several; Escape ends it"],
      ["Double-click the canvas", "Add an agent"],
      ["Drag a dot", "Connect to another element; released on the empty canvas, to a new one"],
      [["C"], "Connect tool: drag from one element to another"],
      [
        "Click a connection in the palette",
        "Draw that kind: drag from one element to another, or from a dot",
      ],
    ],
  ],
  [
    "Select and change",
    [
      ["Click", "Select"],
      [["Shift", "Click"], "Add to the selection, or take from it"],
      ["Drag on the canvas", "Select with a frame; inside a container, its parts"],
      [["Ctrl", "A"], "Select everything"],
      [["Escape"], "End a gesture or a tool; then clear the selection"],
      [["Enter", "F2"], "Name an element; a double click does too"],
      ["Drag a connection's end", "Attach it to another element"],
      ["Drag a label", "Stand it elsewhere; it keeps beside its line"],
      ["Right-click", "Menu: put in a box, change a kind, arrange, ..."],
      [["Ctrl", "Alt", "A"], "Put the selection in an agent"],
      [["Ctrl", "Alt", "S"], "Put the selection in a storage"],
      [["Ctrl", "G"], "Put the selection in a group"],
      [["Ctrl", "Shift", "G"], "Take a group or a box apart"],
      [["Delete"], "Remove"],
    ],
  ],
  [
    "Move and arrange",
    [
      [
        "Drag",
        "Move; into a container to put it inside. A container moves by its title, or once selected",
      ],
      [["Shift", "Drag"], "Keep to one axis"],
      [["Ctrl", "Drag"], "Drag a copy away"],
      [["Alt", "Drag"], "No snapping"],
      [["←", "↑", "→", "↓"], "Move by 10; with Shift by 1"],
      [["Ctrl", "D"], "Duplicate"],
      [["Ctrl", "C"], "Copy; X cuts, V pastes"],
      [["Ctrl", "Z"], "Undo"],
      [["Ctrl", "Y"], "Redo; Ctrl+Shift+Z does too"],
    ],
  ],
  VIEW_KEYS,
];

/** What the sheet of a UML type needs of its structure: the usual piece's name, how many kinds of join it has, and
 *  whether a part can be duplicated. */
export type StructureFacts = { usual: string; links: number; copy: boolean };

/** Rows of a sheet that only some diagram types have. */
const when = (has: boolean, rows: SheetRow[]): SheetRow[] => (has ? rows : []);

/** What the keyboard and the mouse do in a UML diagram of `kind` (its type named `plural`), which lays itself out:
 *  its parts are added, named, joined and removed. */
function structureKeys(
  kind: string,
  plural: string,
  facts: StructureFacts | undefined,
): SheetGroup[] {
  const usual = facts?.usual.toLowerCase() ?? "part";
  return [
    [
      "Add and connect",
      [
        ["Click a shape", "Add it at the selected part"],
        ["Drag a shape", "Carry it onto a part, into a group, or to the empty canvas"],
        ["Double-click the canvas", `Add a ${usual}`],
        [
          "Drag a dot",
          (facts?.links ?? 0) > 1
            ? "Connect to another part, with the kind picked under Shapes; released on the empty canvas, to a new part"
            : "Connect to another part; released on the empty canvas, to a new part",
        ],
        [["C"], "Connect tool: drag from one part to another"],
      ],
    ],
    [
      "Select and change",
      [
        ["Click", "Select a part or a connection"],
        [["Shift", "Click"], "Add to the selection, or take from it"],
        [["Ctrl", "A"], "Select everything"],
        [["Escape"], "End a gesture or a tool; then clear the selection"],
        ["Double-click", "Name a part, or label a connection"],
        [["Enter", "F2"], "Name the selected part"],
        ["Drag a label", "Stand it elsewhere; it keeps beside its line"],
        ...when(kind === "swimlane", [
          ["Drag a lane's border", "Make the lane before it wider or narrower"],
        ]),
        ["Right-click", "Menu: add here, change a kind, delete"],
        ...when(kind === "sequence", [
          [
            ["←", "↑", "→", "↓"],
            "Move the selected message earlier or later, a participant along its row",
          ],
        ]),
        ...when(!!facts?.copy, [[["Ctrl", "D"], "Duplicate the selected part"]]),
        [["Delete"], "Remove, with the connections"],
        [["Ctrl", "Z"], "Undo"],
        [["Ctrl", "Y"], "Redo; Ctrl+Shift+Z does too"],
      ],
    ],
    VIEW_KEYS,
    [
      "Layout",
      [
        [
          "Positions",
          `${plural} lay themselves out until a part is dragged: then every part keeps its place (Arrange ▸ Auto layout lays them out again)`,
        ],
        [
          "Source",
          "Every change is an edit of the text in the Source section, and the other way round",
        ],
      ],
    ],
  ];
}

/** The sheet of a diagram of `kind` ("tam": a block diagram), its type named `name`. */
export function helpSheet(kind: string, name: string, facts?: StructureFacts): SheetGroup[] {
  return kind === "tam" ? BLOCK_KEYS : structureKeys(kind, `${name}s`, facts);
}
