/**
 * The editor's dialogs: the chooser of diagram types, a question before something is replaced, and
 * the two help sheets (keyboard and mouse, the TAM syntax).
 */

import { svgUrl } from "../src/index.ts";
import { h, icon, iconButton } from "./dom.ts";
import { STARTER } from "./starter.ts";
import { type DiagramType, TYPES, type TypeInfo } from "./types.ts";

/**
 * A dialog with its title and a close button at the top right, open over the page. It leaves the
 * page when it closes: by its button, by Escape, or by a click beside it.
 */
function dialog(kind: string, title: string, ...body: (HTMLElement | false)[]): HTMLDialogElement {
  const box = h(
    "dialog",
    { class: `dialog ${kind}`, tabindex: "-1" },
    h(
      "header",
      {},
      h("h1", {}, title),
      iconButton("close", { tip: "Close", key: "Esc" }, () => box.close()),
    ),
    ...body,
  ) as HTMLDialogElement;
  box.addEventListener("close", () => box.remove());
  box.addEventListener("pointerdown", (event) => {
    if (event.target === box) box.close();
  });
  document.body.append(box);
  box.showModal();
  // The focus starts on the dialog, not on its close button.
  if (!box.querySelector("[autofocus]")) box.focus();
  return box;
}

/** What the pointer does, which a sheet writes as words between the keys. */
const GESTURES = new Set(["Click", "Drag", "Wheel"]);

/**
 * A sheet of what each key, gesture or line of code does, in groups. Keys are given as a list and
 * show as keycaps; a gesture is given as a sentence.
 */
function sheet(groups: [string, [string | string[], string][]][], code: boolean): HTMLElement {
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

/** What the keyboard and the mouse do. Opened again while it is open, it closes. */
export function helpDialog() {
  const existing = document.querySelector<HTMLDialogElement>("dialog.help");
  if (existing) return existing.close();
  const box = dialog(
    "help",
    "Keyboard and mouse",
    sheet(
      [
        [
          "Add and connect",
          [
            ["Drag a shape", "Add it where it is dropped"],
            [["A", "U", "S", "G"], "Agent, human, storage, group: then click"],
            ["Double-click a shape", "Keep the tool to place several; Escape ends it"],
            ["Double-click the canvas", "Add an agent"],
            ["Click a dot", "Add a connected agent on that side"],
            ["Drag a dot", "Connect to another element, or to a new one"],
            [["C"], "Connect tool"],
          ],
        ],
        [
          "Select and change",
          [
            ["Click", "Select"],
            [["Shift", "Click"], "Add to the selection, or take from it"],
            ["Drag on the canvas", "Select with a frame"],
            [["Enter", "F2"], "Name an element; a double click does too"],
            ["Drag a connection's end", "Attach it to another element"],
            ["Right-click", "Menu: put in a box, change a kind, arrange, …"],
            [["Ctrl", "G"], "Put the selection in an agent"],
            [["Ctrl", "Shift", "G"], "Put the selection in a group"],
            [["Delete"], "Remove"],
          ],
        ],
        [
          "Move and arrange",
          [
            ["Drag", "Move; into a container to put it inside"],
            [["Shift", "Drag"], "Keep to one axis"],
            [["Ctrl", "Drag"], "Drag a copy away"],
            [["Alt", "Drag"], "No snapping"],
            [["←", "↑", "→", "↓"], "Move by 10; with Shift by 1"],
            [["Ctrl", "D"], "Duplicate"],
            [["Ctrl", "C"], "Copy; X cuts, V pastes"],
            [["Ctrl", "Z"], "Undo; with Shift, redo"],
          ],
        ],
        [
          "View and files",
          [
            ["Wheel", "Move the view; Space-drag and the middle button do too"],
            [["Ctrl", "Wheel"], "Zoom; + and − do too"],
            [["1"], "Fit the diagram"],
            [["2"], "Fit the selection"],
            [["Ctrl", "0"], "Zoom to 100%"],
            [["V", "H"], "Select tool, pan tool"],
            [["Ctrl", "S"], "Save the source as a file"],
            [["Ctrl", "O"], "Open a file"],
            [["Ctrl", "Alt", "N"], "New diagram"],
          ],
        ],
      ],
      false,
    ),
  );
  box.addEventListener("keydown", (event) => {
    if (event.key === "?") box.close();
  });
}

/** The TAM notation on one sheet: what a line of the source may say. */
export function syntaxDialog() {
  dialog(
    "help syntax",
    "TAM syntax",
    sheet(
      [
        [
          "Diagram",
          [
            ["title Order system", "The title"],
            ["direction LR", "The way an automatic layout runs: TB, LR, BT or RL"],
            [
              "level conceptual",
              "Only agents, storages and channels; level design takes components",
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
            ["agent shop[Web Shop] { … }", "A container: its parts stand between the braces"],
            ["storage cart[Cart]:::blue", "A color"],
            [
              "agent worker[Worker] stack",
              "Several, drawn as a stack; … draws two with dots between",
            ],
            ["agent api[Order API] @250,90 140x40", "A position, and a least size"],
          ],
        ],
        [
          "Connections",
          [
            ["a -- calls: place order @HTTPS --> b", "A request with a label and a protocol"],
            ["a <-- calls --> b", "Requests both ways"],
            ["a -- sends data --> b", "A data flow"],
            ["a --- b", "A channel without a direction"],
            ["a -- reads --> s", "An access to a storage: reads, writes or reads/writes"],
            ["a -- requires IOrders --> b", "An interface one requires and the other provides"],
            ["a provides IRefund", "An interface without a partner; requires works the same"],
            ["a -. use .-> b", "A dependency: use, import, create, generate or pointer"],
          ],
        ],
      ],
      true,
    ),
    h(
      "p",
      { class: "note" },
      "The other diagram types are written in Mermaid's syntax; the snippets on the left add their usual statements.",
    ),
  );
}

/** Asks before something is lost; resolves true when the user goes on. */
export function confirmDialog(title: string, message: string, action: string): Promise<boolean> {
  return new Promise((resolve) => {
    let sure = false;
    const box = dialog(
      "confirm",
      title,
      h("p", {}, message),
      h(
        "footer",
        {},
        h(
          "button",
          { class: "button outlined", type: "button", onClick: () => box.close() },
          "Cancel",
        ),
        h(
          "button",
          {
            class: "button primary",
            type: "button",
            autofocus: true,
            onClick: () => {
              sure = true;
              box.close();
            },
          },
          action,
        ),
      ),
    );
    box.addEventListener("close", () => resolve(sure));
  });
}

/** What the chooser of diagram types needs from the page. */
export interface ChooserHost {
  /** The type of the diagram on show: its card is the one picked at first. */
  current: DiagramType;
  /** Whether the diagram on show has changes that were not saved. */
  unsaved: boolean;
  /** A source drawn as an SVG, for the picture on a card. */
  sketch(source: string): Promise<string | undefined>;
  /** Starts the diagram the user chose. */
  create(source: string): void;
}

/**
 * The chooser of a new diagram: a card for each type with a picture of it, and below the cards
 * what to start from, an empty diagram or one of the type's examples.
 */
export function chooser(host: ChooserHost) {
  const existing = document.querySelector<HTMLDialogElement>("dialog.chooser");
  if (existing) return;
  let type = host.current,
    source = "";
  const starts = h("div", { class: "starts", role: "listbox", "aria-label": "Start from" });
  const create = () => {
    box.close();
    host.create(source);
  };
  const pick = (info: TypeInfo) => {
    type = info.type;
    for (const [other, card] of cards) card.setAttribute("aria-pressed", String(other === type));
    const rows: [string, string][] = [
      [info.mode === "canvas" ? "Empty diagram" : "A small diagram to change", info.starter],
      ...info.examples,
    ];
    source = info.starter;
    starts.replaceChildren(
      ...rows.map(([name, text], index) => {
        const row = h(
          "button",
          {
            class: "start",
            type: "button",
            role: "option",
            "aria-selected": String(index === 0),
            onClick: () => {
              source = text;
              for (const other of starts.children)
                other.setAttribute("aria-selected", String(other === row));
            },
            onDblclick: create,
          },
          icon(index ? "file" : "plus"),
          h("span", {}, name),
        );
        return row;
      }),
    );
  };
  const cards = new Map(
    TYPES.map((info) => {
      const picture = h("img", { alt: "", draggable: "false" });
      // The picture is the type's own starter, drawn by the library and shown as an image.
      void host.sketch(info.starter || STARTER).then((svg) => {
        if (svg) picture.src = svgUrl(svg);
      });
      const card = h(
        "button",
        { class: "card", type: "button", onClick: () => pick(info), onDblclick: create },
        h("span", { class: "thumb" }, picture),
        h("span", { class: "name" }, icon(info.icon), h("span", {}, info.name)),
        h(
          "span",
          { class: "badge" },
          info.mode === "canvas"
            ? "Canvas"
            : info.mode === "structure"
              ? "Canvas, automatic layout"
              : "Text + preview",
        ),
      );
      return [info.type, card] as const;
    }),
  );
  const box = dialog(
    "chooser",
    "New diagram",
    h("div", { class: "cards" }, ...cards.values()),
    h("h2", {}, "Start from"),
    starts,
    h(
      "footer",
      {},
      h(
        "span",
        { class: "note" },
        host.unsaved
          ? "The diagram on show has unsaved changes. Undo brings it back."
          : "The new diagram takes the place of the one on show. Undo brings it back.",
      ),
      h(
        "button",
        { class: "button outlined", type: "button", onClick: () => box.close() },
        "Cancel",
      ),
      h("button", { class: "button primary", type: "button", onClick: create }, "Create"),
    ),
  );
  pick(TYPES.find((info) => info.type === type) ?? TYPES[0]);
  cards.get(type)?.focus();
}
