/**
 * The editor's dialogs: the chooser of diagram types, a question before something is replaced, the
 * export of a picture, the list of all commands, and the two help sheets (keyboard and mouse, the
 * syntax of the diagram on show).
 */

import { svgUrl } from "../src/index.ts";
import { h, icon, iconButton, setOff } from "./dom.ts";
import { ageOf, type Recent } from "./files.ts";
import type { Command } from "./menus.ts";
import { STARTER } from "./starter.ts";
import { structureOf } from "./structures.ts";
import { type DiagramType, sameType, TYPES, type TypeInfo, typeInfo, typeOf } from "./types.ts";

/** The parts of a dialog below its title: what scrolls when the window is small, and the row of buttons that stays. */
interface DialogParts {
  body: (HTMLElement | false)[];
  footer?: (HTMLElement | false)[];
}

/**
 * A dialog with its title and a close button at the top, its body, and its buttons at the bottom,
 * open over the page. It is never higher than the window: the body scrolls, the title and the
 * buttons stay. Tab goes round inside it and never leaves it. It leaves the page when it closes:
 * by its button, by Escape, or by a click beside it.
 */
function dialog(kind: string, title: string, parts: DialogParts): HTMLDialogElement {
  const box = h(
    "dialog",
    { class: `dialog ${kind}`, tabindex: "-1" },
    h(
      "header",
      {},
      h("h1", {}, title),
      iconButton("close", { tip: "Close", key: "Esc" }, () => box.close()),
    ),
    h("div", { class: "dialog-body" }, ...parts.body),
    parts.footer && h("footer", {}, ...parts.footer),
  ) as HTMLDialogElement;
  box.addEventListener("close", () => box.remove());
  box.addEventListener("pointerdown", (event) => {
    if (event.target === box) box.close();
  });
  box.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const stops = [
        ...box.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]"),
      ].filter((stop) => stop.tabIndex >= 0 && stop.getClientRects().length > 0),
      first = stops[0],
      last = stops.at(-1),
      active = document.activeElement,
      // From the last stop on to the first, and back from the first to the last.
      next = event.shiftKey
        ? active === first || active === box
          ? last
          : undefined
        : active === last
          ? first
          : undefined;
    if (!first) return event.preventDefault();
    if (!next) return;
    event.preventDefault();
    next.focus();
  });
  document.body.append(box);
  box.showModal();
  // The focus starts on the dialog, not on its close button.
  if (!box.querySelector("[autofocus]")) box.focus();
  return box;
}

/** Whether a dialog is open over the page. */
export const dialogOpen = () => !!document.querySelector("dialog[open]");

/** Puts the focus into the open dialog when it is somewhere else on the page. */
export function focusDialog() {
  const box = document.querySelector<HTMLElement>("dialog[open]");
  if (box && !box.contains(document.activeElement)) box.focus();
}

/** What the pointer does, which a sheet writes as words between the keys. */
const GESTURES = new Set(["Click", "Drag", "Wheel"]);

/** A row of a sheet: the keys, the gesture or the code, and what it does. */
type SheetRow = [string | string[], string];

/** A group of a sheet under its title. */
type SheetGroup = [string, SheetRow[]];

/**
 * A sheet of what each key, gesture or line of code does, in groups. Keys are given as a list and
 * show as keycaps; a gesture is given as a sentence.
 */
function sheet(groups: SheetGroup[], code: boolean): HTMLElement {
  const keys = (how: string | string[]) =>
    typeof how === "string"
      ? [h(code ? "code" : "span", {}, how)]
      : how.map((key) => h(GESTURES.has(key) ? "span" : "kbd", {}, key));
  return h(
    "div",
    { class: "sheet" },
    ...groups.map(([title, rows]) =>
      h(
        "section",
        {},
        h("h2", {}, title),
        ...rows.map(([how, does]) =>
          h("p", {}, h("span", { class: "keys" }, ...keys(how)), h("span", {}, does)),
        ),
      ),
    ),
  );
}

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
    [["Ctrl", "S"], "Save; with Shift, save as another file"],
    [["Ctrl", "O"], "Open a file"],
    [["Ctrl", "Alt", "N"], "New diagram"],
    [["Ctrl", "K"], "All commands, tools and shapes, to pick by typing"],
    [["Alt"], "The menu bar; F10 does too. With a letter, its menu: Alt+F for File"],
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
      ["Right-click", "Menu: put in a box, change a kind, arrange, ..."],
      [["Ctrl", "G"], "Put the selection in an agent"],
      [["Ctrl", "Shift", "G"], "Put the selection in a group"],
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

/** What the keyboard and the mouse do in a diagram that lays itself out: its parts are added, named, joined and removed. */
const structureKeys = (info: TypeInfo): SheetGroup[] => {
  const structure = structureOf(info.type),
    usual = structure?.pieces[0]?.name.toLowerCase() ?? "part";
  return [
    [
      "Add and connect",
      [
        ["Click a shape", "Add it at the selected part"],
        ["Drag a shape", "Carry it onto a part, into a group, or to the empty canvas"],
        ["Double-click the canvas", `Add a ${usual}`],
        [
          "Drag a dot",
          (structure?.links.length ?? 0) > 1
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
        ["Right-click", "Menu: add here, change a kind, delete"],
        ...(info.type === "sequence"
          ? ([
              [
                ["←", "↑", "→", "↓"],
                "Move the selected message earlier or later, a participant along its row",
              ],
            ] satisfies SheetRow[])
          : []),
        ...(structure?.copy
          ? ([[["Ctrl", "D"], "Duplicate the selected part"]] satisfies SheetRow[])
          : []),
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
          `${info.plural} lay themselves out until a part is dragged: then every part keeps its place (Arrange ▸ Auto layout lays them out again)`,
        ],
        [
          "Source",
          "Every change is an edit of the text in the Source section, and the other way round",
        ],
      ],
    ],
  ];
};

/** What the keyboard and the mouse do in a diagram edited as text. */
const TEXT_KEYS: SheetGroup[] = [
  [
    "Edit",
    [
      ["Type in the source", "The picture follows after a moment"],
      [["Ctrl", "Space"], "Complete what is being typed"],
      [["Ctrl", "Z"], "Undo"],
      [["Ctrl", "Y"], "Redo; Ctrl+Shift+Z does too"],
    ],
  ],
  VIEW_KEYS,
];

/** What the keyboard and the mouse do in a diagram of a type. Opened again while it is open, it closes. */
export function helpDialog(type: DiagramType) {
  const existing = document.querySelector<HTMLDialogElement>("dialog.help");
  if (existing) return existing.close();
  const info = typeInfo(type);
  const box = dialog("help", `Keyboard and mouse: ${info.name.toLowerCase()}`, {
    body: [
      sheet(
        info.mode === "canvas"
          ? BLOCK_KEYS
          : info.mode === "structure"
            ? structureKeys(info)
            : TEXT_KEYS,
        false,
      ),
    ],
  });
  box.addEventListener("keydown", (event) => {
    if (event.key === "?") box.close();
  });
}

/** The TAM notation on one sheet: what a line of the source may say. */
const TAM_SYNTAX: SheetGroup[] = [
  [
    "Diagram",
    [
      ["title Order system", "The title"],
      ["direction LR", "The way an automatic layout runs: TB, LR, BT or RL"],
      [
        "level conceptual",
        "Only agents, storages, channels and accesses; level design adds components",
      ],
      ["%% a remark", "A comment"],
    ],
  ],
  [
    "Elements",
    [
      ["agent api[Order API]", "A kind, an id, and the name in brackets"],
      [
        "agent human storage group",
        "The kinds of a block diagram; component, subsystem, class and package at design level",
      ],
      [
        "agent shop[Web Shop] { ... }",
        "A container: its parts stand on the lines between the braces",
      ],
      ["storage cart[Cart]:::blue", "A color"],
      ["agent worker[Worker] stack", "Several, drawn as a stack"],
      [
        "agent worker[Worker] ...",
        "Several, drawn as two with dots between: three dots after the name",
      ],
      ["agent api[Order API] @250,90 140x40", "A position, and a least size"],
    ],
  ],
  [
    "Connections",
    [
      [
        "a -- calls: place order @HTTPS --> b",
        "A request/response channel with a label and a protocol",
      ],
      ["a <-- calls --> b", "A bidirectional request/response channel"],
      ["a -- sends data --> b", "A unidirectional data flow channel"],
      ["a --- b", "A channel without a direction"],
      ["a -- reads --> s", "A storage access: reads, writes or reads/writes"],
      ["a -- requires IOrders --> b", "A required interface of a, provided by b"],
      ["a provides IRefund", "An interface without a partner; requires works the same"],
      ["a -. use .-> b", "A dependency: use, import, create, generate or pointer"],
    ],
  ],
];

/** The first lines of every Mermaid source: a title, and remarks. */
const FRONT: SheetRow[] = [
  ["---\ntitle: Order system\n---", "The title, before the first line of the diagram"],
  ["%% a remark", "A comment"],
];

/**
 * The Mermaid syntax the editor draws, per diagram type: the statements of a diagram and what each
 * says. The rows of a type, read one after the other, are a diagram of that type.
 */
const UML_SYNTAX: Record<Exclude<DiagramType, "tam">, SheetRow[]> = {
  class: [
    ["classDiagram", "The first line: a class diagram"],
    ["class Customer", "A class"],
    [
      "class Order {\n  +id: string\n  -total() number\n}",
      "Members: + public, - private, # protected",
    ],
    [
      "class Payable {\n  <<interface>>\n  +pay()\n}",
      "An interface; <<abstract>> and <<enumeration>> work the same",
    ],
    ["Payable <|.. Order", "Realization: the class realizes the interface"],
    ["Order <|-- RushOrder", "Generalization: the general class first"],
    ['Customer "1" --> "*" Order : places', "An association with multiplicities and a name"],
    ["Order *-- OrderItem", "Composition; o-- is a shared aggregation"],
    ["Order ..> Customer : notifies", "A dependency"],
  ],
  usecase: [
    ["usecase-beta", "The first line: a use case diagram"],
    ["direction LR", "The way the layout runs: LR or TB"],
    ["actor User", "An actor"],
    [
      "systemBoundary shop[Web Shop]\n  browse(Browse Products)\n  order(Place Order)\nend",
      "A system boundary with its use cases: an id, and the name in round brackets",
    ],
    ["User --> browse", "An association: the actor participates in the use case"],
    ["User --> order", "Every line is one association"],
  ],
  flowchart: [
    ["flowchart TB", "The first line: an activity diagram that runs TB, LR, BT or RL"],
    ["start((Start)) --> check{In stock?}", "An initial node, a control flow, and a decision node"],
    ["check -->|yes| ship[Ship order]", "A flow with a guard, to an action"],
    ["check -->|no| wait[Wait for supply]", "The other branch"],
    ["wait --> check", "A flow back"],
    ["ship --> done(((End)))", "An activity final node"],
    [
      "subgraph pack [Packing]\n  box[Box it] --> label[Label it]\nend",
      "A group of activity nodes; a diagram with lanes has none",
    ],
  ],
  swimlane: [
    ["swimlane-beta TB", "The first line: an activity diagram with lanes, running TB or LR"],
    [
      "subgraph Customer\n  start((Start)) --> order(Place Order)\nend",
      "An activity partition with its nodes: an initial node and an action",
    ],
    [
      "subgraph Shop\n  check(Check Order) --> ship(Ship Goods)\n  ship --> stop(((End)))\nend",
      "Another partition, with an activity final node",
    ],
    ["order --> check", "A control flow across partitions"],
  ],
  state: [
    ["stateDiagram-v2", "The first line: a state machine"],
    ["[*] --> Draft", "The initial pseudostate and the default state"],
    ["Draft --> Submitted : submit", "A transition and its trigger event"],
    ['state "Waiting for approval" as Waiting', "A state with a name of several words"],
    ["Submitted --> Waiting", "A transition without an event"],
    [
      "state Review {\n  [*] --> Reading\n  Reading --> [*]\n}",
      "A composite state with its substates",
    ],
    ["Waiting --> Review : assign", "Composite states take transitions like any other"],
    ["Review --> [*]", "A final state"],
  ],
  sequence: [
    ["sequenceDiagram", "The first line: a sequence diagram"],
    ["actor U as User", "An actor, a human agent: an id, and the name"],
    ["participant S as Shop", "A participant with its lifeline"],
    ["U->>S: place order", "A synchronous message"],
    ["S-->>U: confirmation", "A reply message"],
    [
      "alt in stock\n  S->>U: ship\nelse sold out\n  S->>U: refund\nend",
      "Combined fragment alt with two operands; opt has one",
    ],
    ["loop every day\n  S->>S: check supply\nend", "Combined fragment loop, with a self message"],
    ["Note over U,S: A note", "A note over lifelines"],
  ],
  er: [
    ["erDiagram", "The first line: an entity relationship diagram"],
    ["direction LR", "The way the layout runs: TB, LR, BT or RL"],
    ["CUSTOMER", "An entity type"],
    [
      'ORDER {\n  int id PK\n  int customerId FK\n  string status "open or closed"\n}',
      "Attributes: a type and a name, then the keys PK, FK or UK and a comment in quotes",
    ],
    [
      'ITEM["Order item"] {\n  int orderId PK, FK\n  int position PK\n}',
      "A display name; a composite primary key",
    ],
    ["CUSTOMER ||--o{ ORDER : places", "One customer, zero or more orders"],
    ["ORDER ||--|{ ITEM : contains", "One order, one or more items"],
    [
      'CUSTOMER }o..o| ORDER : "last looked at"',
      "Zero or one with o| and |o; dots for a non-identifying relationship",
    ],
    [
      'ORDER one or more to only one CUSTOMER : "belongs to"',
      "The same in words: zero or one, zero or more, one or more, only one; to, optionally to",
    ],
  ],
};

/** The headings of the sheets of the kinds of source a type is also written as. */
const VARIANT_SHEETS: Partial<Record<DiagramType, string>> = {
  swimlane: "With lanes",
};

/** The rows of the syntax sheet of a Mermaid type, in their order. */
export const syntaxRows = (type: Exclude<DiagramType, "tam">): string[] =>
  UML_SYNTAX[type].map(([code]) => code as string);

/** The syntax of a diagram type on one sheet: what the lines of its source may say. */
export function syntaxDialog(type: DiagramType) {
  const info = typeInfo(type);
  if (type === "tam")
    return void dialog("help syntax", "TAM syntax", {
      body: [
        sheet(TAM_SYNTAX, true),
        h(
          "p",
          { class: "note" },
          "The other diagram types are written in Mermaid's syntax: Help shows it while one of them is open.",
        ),
      ],
    });
  dialog("help syntax", `${info.name} syntax`, {
    body: [
      sheet(
        [
          ["Statements", UML_SYNTAX[info.type as Exclude<DiagramType, "tam">]],
          ...(info.variants ?? []).map((variant): [string, SheetRow[]] => [
            VARIANT_SHEETS[variant] ?? variant,
            UML_SYNTAX[variant as Exclude<DiagramType, "tam">],
          ]),
          ["Every type", FRONT],
        ],
        true,
      ),
      h(
        "p",
        { class: "note" },
        "This is the part of Mermaid's syntax the editor draws. The shapes on the left add these statements for you; the source completes them as you type.",
      ),
    ],
  });
}

/** What the user chose when asked before something is lost. */
export type Answer = "go" | "save" | "cancel";

/**
 * Asks before something is lost: to go on, to save first and then go on, or to leave it. The focus
 * starts on leaving it, so Enter loses nothing.
 */
export function confirmDialog(title: string, message: string, action: string): Promise<Answer> {
  return new Promise((resolve) => {
    let answer: Answer = "cancel";
    const answers = (given: Answer) => () => {
      answer = given;
      box.close();
    };
    const box = dialog("confirm", title, {
      body: [h("p", {}, message)],
      footer: [
        h(
          "button",
          { class: "button outlined", type: "button", autofocus: true, onClick: answers("cancel") },
          "Cancel",
        ),
        h("span", { class: "spacer" }),
        h(
          "button",
          { class: "button outlined", type: "button", onClick: answers("save") },
          "Save first",
        ),
        h(
          "button",
          { class: "button primary danger", type: "button", onClick: answers("go") },
          action,
        ),
      ],
    });
    box.addEventListener("close", () => resolve(answer));
  });
}

/** Says what the user should know, as a list under a sentence; closes with its button. */
export function noticeDialog(title: string, message: string, items: string[]) {
  const box = dialog("notice", title, {
    body: [h("p", {}, message), h("ul", {}, ...items.map((item) => h("li", {}, item)))],
    footer: [
      h("span", { class: "spacer" }),
      h(
        "button",
        { class: "button primary", type: "button", autofocus: true, onClick: () => box.close() },
        "OK",
      ),
    ],
  });
}

/**
 * A choice of one among a few, as buttons side by side. The arrow keys go from one to the next.
 * Returns the control and what sets the choice and turns single choices off.
 */
function segments<Value extends string>(
  label: string,
  choices: [Value, string][],
  start: Value,
  chosen: (value: Value) => void,
) {
  let value = start;
  const show = () =>
    buttons.forEach((button, index) => {
      const on = choices[index][0] === value;
      button.setAttribute("aria-checked", String(on));
      button.setAttribute("aria-pressed", String(on));
      button.tabIndex = on ? 0 : -1;
    });
  const set = (next: Value) => {
    value = next;
    show();
    chosen(next);
  };
  const buttons = choices.map(([choice, name]) =>
    h(
      "button",
      { class: "segment", type: "button", role: "radio", onClick: () => set(choice) },
      name,
    ),
  );
  const element = h(
    "div",
    { class: "segments", role: "radiogroup", "aria-label": label },
    ...buttons,
  );
  element.addEventListener("keydown", (event) => {
    const by = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (!by) return;
    event.preventDefault();
    const on = buttons.filter((button) => button.getAttribute("aria-disabled") !== "true"),
      at = on.indexOf(document.activeElement as HTMLButtonElement),
      next = on[(at + by + on.length) % on.length];
    next?.focus();
    next?.click();
  });
  show();
  return {
    element,
    /** Turns the whole choice off, with the reason, or on again. */
    setOff: (reason: string | undefined) => buttons.forEach((button) => setOff(button, reason)),
  };
}

/** What is behind an exported picture: white, nothing, or the page color of the editor's theme. */
export type Backdrop = "white" | "transparent" | "theme";

/** How a picture is exported. */
export interface ExportOptions {
  format: "svg" | "png";
  /** The pixels of a PNG per unit of the diagram. */
  scale: 1 | 2 | 3;
  backdrop: Backdrop;
  /** The room around the picture, in units of the diagram. */
  margin: number;
}

/** What the export dialog needs from the page. */
export interface ExportHost {
  /** The choices the dialog starts with. */
  options: ExportOptions;
  /** Whether the editor shows in its dark theme, which "Editor theme" then names. */
  dark: boolean;
  /** The file name a format is saved under. */
  name(format: "svg" | "png"): string;
  /** The picture as an SVG with a backdrop and room around it, and its size in units of the diagram. */
  picture(
    backdrop: Backdrop,
    margin: number,
  ): { svg: string; width: number; height: number } | undefined;
  /** Writes the picture as a file. */
  save(options: ExportOptions): void;
}

/**
 * The export of the picture: its format, the scale of a PNG, what is behind it, the room around
 * it, and a preview of what the file will hold. The picture is drawn in the light colors unless the editor's theme is asked for.
 */
export function exportDialog(host: ExportHost) {
  if (document.querySelector("dialog.export")) return;
  const options = { ...host.options };
  const preview = h("img", { alt: "Preview of the exported picture", draggable: "false" }),
    size = h("span", { class: "note" });
  const format = segments(
    "Format",
    [
      ["svg", "SVG"],
      ["png", "PNG"],
    ],
    options.format,
    (value) => {
      options.format = value;
      show();
    },
  );
  const scale = segments(
    "Scale",
    [
      ["1", "1×"],
      ["2", "2×"],
      ["3", "3×"],
    ],
    String(options.scale) as "1" | "2" | "3",
    (value) => {
      options.scale = Number(value) as ExportOptions["scale"];
      show();
    },
  );
  const backdrop = segments<Backdrop>(
    "Background",
    [
      ["white", "White"],
      ["transparent", "Transparent"],
      ["theme", host.dark ? "Editor theme (dark)" : "Editor theme (light)"],
    ],
    options.backdrop,
    (value) => {
      options.backdrop = value;
      show();
    },
  );
  const margin = segments(
    "Margin",
    [
      ["0", "None"],
      ["16", "16 px"],
      ["32", "32 px"],
    ],
    String(options.margin) as "0" | "16" | "32",
    (value) => {
      options.margin = Number(value);
      show();
    },
  );
  const bare = h(
    "p",
    { class: "note" },
    "With nothing behind them, labels on lines have no light outline, and shapes keep their fill. The picture is drawn for a light page.",
  );
  const row = (name: string, control: HTMLElement) =>
    h("div", { class: "row" }, h("span", {}, name), control);
  const show = () => {
    const picture = host.picture(options.backdrop, options.margin),
      png = options.format === "png",
      times = png ? options.scale : 1;
    scale.setOff(png ? undefined : "An SVG is sharp at every size");
    if (picture) preview.src = svgUrl(picture.svg);
    size.textContent = picture
      ? `${host.name(options.format)} · ${Math.ceil(picture.width * times)} × ${Math.ceil(picture.height * times)}${png ? " pixels" : ""}`
      : "";
    bare.hidden = options.backdrop !== "transparent";
    file.textContent = `Export ${png ? "PNG" : "SVG"}`;
  };
  const file = h("button", {
    class: "button primary",
    type: "button",
    autofocus: true,
    onClick: () => {
      box.close();
      host.save(options);
    },
  });
  const box = dialog("export", "Export a picture", {
    body: [
      h("div", { class: "export-preview" }, preview),
      h(
        "div",
        { class: "export-options" },
        row("Format", format.element),
        row("Scale", scale.element),
        row("Background", backdrop.element),
        row("Margin", margin.element),
        bare,
      ),
    ],
    footer: [
      size,
      h(
        "button",
        { class: "button outlined", type: "button", onClick: () => box.close() },
        "Cancel",
      ),
      file,
    ],
  });
  show();
}

/** The commands asked for most, by name: the list starts with them while nothing is typed. */
const USUAL = ["Save", "Undo", "Redo", "New…", "Open…", "Export SVG…", "Export PNG…"];

/** A name as it is typed: lower case, without the dots that say a dialog follows. */
const plain = (name: string) => name.toLowerCase().replace(/…$/, "");

/**
 * The commands a text typed into the list of all commands asks for, the likeliest first: those
 * whose name or menu holds every word typed. A name that is the text comes first, then a name
 * that starts with it, a name with a word that starts with it, a name that holds it, a command
 * only the menu of which holds it, and last the diagrams to open; among equals, one that can be
 * run comes first. With
 * nothing typed the list is every command: the usual ones, then the menus in their order, and the
 * diagrams to open last.
 */
export function findCommands(commands: Command[], typed: string): Command[] {
  const text = typed.trim().toLowerCase(),
    words = text.split(/\s+/).filter(Boolean);
  const diagram = (command: Command) => /Open (recent|example)/.test(command.path);
  if (!words.length) {
    const usual = USUAL.flatMap(
        (name) =>
          commands.find((command) => command.name === name && !command.path.includes("▸")) ?? [],
      ),
      rest = commands.filter((command) => !usual.includes(command));
    return [...usual, ...rest.filter((command) => !diagram(command)), ...rest.filter(diagram)];
  }
  const rank = (command: Command) => {
    const name = plain(command.name);
    // A diagram to open is asked for less than a command of the same name.
    if (diagram(command)) return 5;
    if (name === text) return 0;
    if (name.startsWith(text)) return 1;
    if (name.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(words[0]))) return 2;
    return words.every((word) => name.includes(word)) ? 3 : 4;
  };
  return commands
    .filter((command) => {
      const all = `${command.path} ${command.name}`.toLowerCase();
      return words.every((word) => all.includes(word));
    })
    .map((command) => ({ command, rank: rank(command) }))
    .toSorted((a, b) => a.rank - b.rank || Number(!!a.command.off) - Number(!!b.command.off))
    .map(({ command }) => command);
}

/**
 * The list of all commands: typing narrows it to the commands whose name or menu holds every word
 * typed, the arrow keys go through it, Enter runs the marked one. A command that cannot be run
 * now says why when it is asked for.
 */
export function commandDialog(commands: Command[]) {
  const existing = document.querySelector<HTMLDialogElement>("dialog.commands");
  if (existing) return existing.close();
  const list = h("div", { class: "command-list", role: "listbox", id: "command-list" });
  const field = h("input", {
    class: "field",
    type: "text",
    autofocus: true,
    spellcheck: "false",
    placeholder: "Type a command…",
    role: "combobox",
    "aria-label": "Command",
    "aria-controls": "command-list",
    "aria-expanded": "true",
  });
  const said = h("p", { class: "command-said", role: "status" });
  said.hidden = true;
  let found: Command[] = [],
    at = 0;
  const mark = (scroll = true) =>
    [...list.children].forEach((row, index) => {
      row.setAttribute("aria-selected", String(index === at));
      if (index === at && scroll) row.scrollIntoView({ block: "nearest" });
    });
  const run = (command: Command | undefined) => {
    if (!command) return;
    if (command.off) {
      said.textContent = `${command.name} is not available: ${
        typeof command.off === "string"
          ? `${command.off[0].toLowerCase()}${command.off.slice(1)}`
          : "it does not apply now"
      }.`;
      said.hidden = false;
      return;
    }
    box.close();
    command.run();
  };
  const show = () => {
    found = findCommands(commands, field.value);
    said.hidden = true;
    at = 0;
    list.replaceChildren(
      ...(found.length
        ? found.map((command, index) => {
            const row = h(
              "div",
              {
                class: "command",
                role: "option",
                "aria-disabled": command.off ? "true" : undefined,
                "data-tip": typeof command.off === "string" ? command.off : undefined,
                "data-side": "right",
                onClick: () => run(command),
                onPointermove: () => {
                  if (at === index) return;
                  at = index;
                  mark(false);
                },
              },
              h("span", { class: "name" }, command.name),
              h("span", { class: "path" }, command.path),
              command.key && h("kbd", {}, command.key),
            );
            return row;
          })
        : [h("p", { class: "note" }, "No command has these words.")]),
    );
    list.scrollTop = 0;
    mark();
  };
  field.addEventListener("input", show);
  field.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step && found.length) {
      event.preventDefault();
      at = (at + step + found.length) % found.length;
      said.hidden = true;
      mark();
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(found[at]);
    }
  });
  const box = dialog("commands", "All commands", { body: [field, list, said] });
  show();
}

/** What the chooser of diagram types needs from the page. */
export interface ChooserHost {
  /** The type of the diagram on show: its card is the one picked at first. */
  current: DiagramType;
  /** Whether the diagram on show has changes that were not saved. */
  unsaved: boolean;
  /** The diagrams that were on show lately. */
  recents: Recent[];
  /** A source drawn as an SVG, for the picture on a card. */
  sketch(source: string): Promise<string | undefined>;
  /** Starts the diagram the user chose. */
  create(source: string): void;
}

/**
 * The pictures on the cards of the chooser: a small diagram of each type that is wider than high,
 * as the window of a card is. A type without one shows its starter.
 */
const THUMBS: Partial<Record<DiagramType, string>> = {
  tam: STARTER,
  class: `classDiagram
  direction LR
  class Customer {
    +name: string
  }
  class Order {
    +id: string
    +total() number
  }
  Customer "1" --> "*" Order : places`,
  usecase: `usecase-beta
  direction LR
  actor User
  systemBoundary shop[Web Shop]
    browse(Browse Products)
    order(Place Order)
  end
  User --> browse
  User --> order`,
  flowchart: `flowchart LR
  start((Start)) --> check{In stock?}
  check -->|yes| ship[Ship order]
  check -->|no| wait[Wait]
  ship --> done(((End)))`,
  state: `stateDiagram-v2
  direction LR
  [*] --> Draft
  Draft --> Approved : approve
  Draft --> Rejected : reject`,
  sequence: `sequenceDiagram
  participant U as User
  participant S as Shop
  participant P as Payment
  U->>S: place order
  S->>P: charge
  P-->>S: paid`,
  er: `erDiagram
  direction LR
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    int id PK
    string name
  }
  ORDER {
    int id PK
    date placed
  }`,
};

/** How much wider than high a picture may be to fill the window of a card; any other shows whole. */
const FILLS = { least: 1.7, most: 2.6 };

/** The source of the picture on a type's card. */
export const thumbOf = (info: TypeInfo): string => THUMBS[info.type] ?? (info.starter || STARTER);

/** How a type is worked on, in a few plain words. */
const BADGES: Record<TypeInfo["mode"], string> = {
  canvas: "Placed by hand",
  structure: "Lays itself out",
  text: "Written as text",
};

/** A diagram to start from, as the chooser lists it. */
interface Start {
  name: string;
  source: string;
  icon: "plus" | "file";
  /** A word after the name that says where it comes from. */
  tag?: string;
}

/** What the chooser offers to start a diagram of a type from: a new one, the diagrams of that type on show lately, and the examples. */
export function startsOf(info: TypeInfo, recents: Recent[]): Start[] {
  const first: Start[] = [
    info.starter
      ? { name: "Small starter diagram", source: info.starter, icon: "plus" }
      : { name: "Empty diagram", source: "", icon: "plus" },
    ...(info.type === "tam"
      ? [{ name: "Order system (sample)", source: STARTER, icon: "file" as const }]
      : []),
  ];
  const examples = info.examples.map(([name, source]): Start => ({ name, source, icon: "file" }));
  // One row per source: a recent diagram that is an example shows as the example.
  const known = new Set([...first, ...examples].map((start) => start.source));
  return [
    ...first,
    ...recents
      .filter((recent) => sameType(typeOf(recent.source), info.type) && !known.has(recent.source))
      .map((recent): Start => ({
        name: recent.title,
        source: recent.source,
        icon: "file",
        tag: recent.at ? `Recent · ${ageOf(recent.at)}` : "Recent",
      })),
    ...examples,
  ];
}

/**
 * The chooser of a new diagram: a card for each type with a picture of it, and below the cards
 * what to start from (a new diagram, a recent one, an example of the type) beside a picture of it.
 * The arrow keys go through the cards and through the list; Enter creates.
 */
export function chooser(host: ChooserHost) {
  const existing = document.querySelector<HTMLDialogElement>("dialog.chooser");
  if (existing) return;
  let type = typeInfo(host.current).type,
    source = "",
    turn = 0;
  const starts = h("div", { class: "starts", role: "listbox", "aria-label": "Start from" });
  const picture = h("img", { alt: "", draggable: "false" }),
    blank = h("span", { class: "note" }),
    preview = h("div", { class: "start-preview" }, picture, blank);
  const create = () => {
    box.close();
    host.create(source);
  };
  /** Picks a row of the list: it is the one Create starts from, and the picture beside the list shows it. */
  const choose = (row: HTMLElement, start: Start, focus = false) => {
    source = start.source;
    for (const other of starts.children) {
      other.setAttribute("aria-selected", String(other === row));
      (other as HTMLElement).tabIndex = other === row ? 0 : -1;
    }
    row.scrollIntoView({ block: "nearest" });
    if (focus) row.focus();
    const mine = ++turn;
    picture.hidden = true;
    blank.textContent = start.source.trim() ? "" : "An empty canvas";
    if (start.source.trim())
      void host.sketch(start.source).then((svg) => {
        if (mine !== turn) return;
        if (svg) picture.src = svgUrl(svg);
        picture.hidden = !svg;
        blank.textContent = svg ? "" : "No picture of this one";
      });
  };
  const pick = (info: TypeInfo) => {
    type = info.type;
    for (const [other, card] of cards) {
      card.setAttribute("aria-checked", String(other === type));
      card.tabIndex = other === type ? 0 : -1;
    }
    const list = startsOf(info, host.recents);
    const rows = list.map((start) => {
      const row: HTMLElement = h(
        "div",
        {
          class: "start",
          role: "option",
          "data-tip": start.name.length > 40 ? start.name : undefined,
          "data-side": "top",
          onClick: () => choose(row, start, true),
          onDblclick: create,
        },
        icon(start.icon),
        h("span", { class: "name" }, start.name),
        start.tag && h("span", { class: "tag" }, start.tag),
      );
      return row;
    });
    starts.replaceChildren(...rows);
    choose(rows[0], list[0]);
    starts.scrollTop = 0;
  };
  starts.addEventListener("keydown", (event) => {
    const rows = [...starts.children] as HTMLElement[],
      at = rows.findIndex((row) => row.getAttribute("aria-selected") === "true"),
      to = {
        ArrowDown: Math.min(at + 1, rows.length - 1),
        ArrowUp: Math.max(at - 1, 0),
        Home: 0,
        End: rows.length - 1,
      }[event.key];
    if (event.key === "Enter") {
      event.preventDefault();
      return create();
    }
    if (to === undefined) return;
    event.preventDefault();
    rows[to]?.click();
  });
  const cards = new Map(
    TYPES.map((info) => {
      const thumb = h("img", { alt: "", draggable: "false" });
      // The picture is a small diagram of the type, drawn by the library and shown as an image.
      void host.sketch(thumbOf(info)).then((svg) => {
        if (!svg) return;
        const [, width, height] = svg.match(/width="([\d.]+)" height="([\d.]+)"/) ?? [],
          wide = Number(width) / Number(height);
        thumb.classList.toggle("whole", !(wide >= FILLS.least && wide <= FILLS.most));
        thumb.src = svgUrl(svg);
      });
      const card = h(
        "button",
        {
          class: "card",
          type: "button",
          role: "radio",
          "data-tip": info.about,
          "data-side": "bottom",
          onClick: () => pick(info),
          onDblclick: create,
        },
        h("span", { class: "thumb" }, thumb),
        h("span", { class: "name" }, icon(info.icon), h("span", {}, info.name)),
        h("span", { class: "badge" }, BADGES[info.mode]),
      );
      return [info.type, card] as const;
    }),
  );
  const deck = h(
    "div",
    { class: "cards", role: "radiogroup", "aria-label": "Diagram type" },
    ...cards.values(),
  );
  deck.addEventListener("keydown", (event) => {
    const list = [...cards.values()],
      at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    if (event.key === "Enter") {
      event.preventDefault();
      return create();
    }
    // The cards of a row stand at one height: as many as the first row has make a step up or down.
    const across = list.filter((card) => card.offsetTop === list[0].offsetTop).length,
      by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -across, ArrowDown: across }[event.key];
    if (!by) return;
    event.preventDefault();
    const next = list[at + by];
    if (!next) return;
    next.focus();
    next.click();
  });
  const box = dialog("chooser", "New diagram", {
    body: [deck, h("h2", {}, "Start from"), h("div", { class: "starts-row" }, starts, preview)],
    footer: [
      host.unsaved
        ? h(
            "span",
            { class: "note warning" },
            icon("warning"),
            h("span", {}, "The diagram on show has unsaved changes. Undo brings it back."),
          )
        : h(
            "span",
            { class: "note" },
            "The new diagram takes the place of the one on show. Undo brings it back.",
          ),
      h(
        "button",
        { class: "button outlined", type: "button", onClick: () => box.close() },
        "Cancel",
      ),
      h("button", { class: "button primary", type: "button", onClick: create }, "Create"),
    ],
  });
  pick(TYPES.find((info) => info.type === type) ?? TYPES[0]);
  cards.get(type)?.focus();
}
