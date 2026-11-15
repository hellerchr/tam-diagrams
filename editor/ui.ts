/** The editor's panels: toolbar, tools, inspector, source and status, built on the page around the canvas. */

import type { Box } from "../src/scene.ts";
import { COLORS, ELEMENT_KINDS, type Connection, type Word } from "../src/tam.ts";
import type { ElementKind } from "../src/tam-edit.ts";
import type { Direction } from "../src/elk.ts";
import { TAM_EXAMPLES } from "../src/samples/tam-examples.ts";
import type { Editor, Tool, TreeItem } from "./editor.ts";
import { ICONS } from "./icons.ts";

type Child = Node | string | false | null | undefined;

/** An element with attributes, listeners (`on...`) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (name.startsWith("on") && typeof value === "function")
      element.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    else if (name === "class") element.className = String(value);
    else if (name === "value") (element as HTMLInputElement).value = String(value);
    else element.setAttribute(name, value === true ? "" : String(value));
  }
  element.append(...children.filter((child): child is Node | string => !!child));
  return element;
}

/** An icon: one of the drawings in icons.ts, parsed as an image of its own, not as markup of the page. */
function icon(name: keyof typeof ICONS): HTMLElement {
  const holder = h("span", { class: "icon", "aria-hidden": "true" });
  const svg = new DOMParser().parseFromString(ICONS[name], "image/svg+xml").documentElement;
  holder.append(document.importNode(svg, true));
  return holder;
}

interface ToolItem {
  tool: Tool;
  icon: keyof typeof ICONS;
  name: string;
  key?: string;
  /** What the element stands for, for its tooltip. */
  hint?: string;
}

const POINTERS: ToolItem[] = [
  { tool: "select", icon: "select", name: "Select", key: "V", hint: "Select, move and resize" },
  { tool: "pan", icon: "pan", name: "Pan", key: "H", hint: "Move the view" },
  {
    tool: "connect",
    icon: "connect",
    name: "Connect",
    key: "C",
    hint: "Drag from one element to another",
  },
];

/** The shapes of the palette, by the level of the notation they belong to. */
const SHAPES: { title: string; items: ToolItem[] }[] = [
  {
    title: "Block diagram",
    items: [
      {
        tool: "agent",
        icon: "agent",
        name: "Agent",
        key: "A",
        hint: "Does something: a service, a process",
      },
      {
        tool: "human",
        icon: "human",
        name: "Human",
        key: "U",
        hint: "A person who uses the system",
      },
      {
        tool: "storage",
        icon: "storage",
        name: "Storage",
        key: "S",
        hint: "Keeps information: a database, a file",
      },
      { tool: "group", icon: "group", name: "Group", key: "G", hint: "A frame around elements" },
    ],
  },
  {
    title: "Design level",
    items: [
      { tool: "component", icon: "component", name: "Component" },
      { tool: "subsystem", icon: "subsystem", name: "Subsystem" },
      { tool: "class", icon: "class", name: "Class" },
      { tool: "package", icon: "package", name: "Package" },
    ],
  },
];

const HINTS: Record<string, string> = {
  select:
    "Drag to move · drag the dots to connect · drag a connection's end to another element · right-click for more",
  pan: "Drag to move the view · Ctrl + wheel zooms",
  connect: "Drag from one element to another",
};

/** The kinds of connection the inspector offers: a word, and for dependencies their keyword. */
const WIRES: { value: string; name: string; word: Word; keyword?: string }[] = [
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

const wireChange = (kind: (typeof WIRES)[number]) => ({
  word: kind.word,
  ...(kind.keyword ? { label: kind.keyword } : {}),
});

const wireValue = (connection: Connection) =>
  connection.word === "dependency" ? `dependency:${connection.label}` : connection.word;

/** What the page offers the panels: files, the theme and the view. */
export interface Shell {
  newDiagram(): void;
  openFile(): void;
  saveFile(): void;
  exportSvg(): void;
  exportPng(): void;
  copySource(): void;
  openExample(source: string): void;
  toggleTheme(): void;
  /** Remembers a choice across visits. */
  remember(key: string, value: string): void;
  recall(key: string): string | null;
}

export class Panels {
  private readonly editor: Editor;
  private readonly shell: Shell;
  private readonly tools = new Map<Tool, HTMLButtonElement>();
  private readonly inspector = h("div", { class: "inspector" });
  private readonly source = h("textarea", {
    class: "source",
    spellcheck: "false",
    autocomplete: "off",
    autocapitalize: "off",
    wrap: "off",
    "aria-label": "Diagram source",
  });
  private readonly problem = h("div", { class: "problem", role: "status" });
  private readonly warning = h("div", { class: "problem warning", role: "status" });
  private readonly status = h("div", { class: "hint" });
  private readonly mode = h("span", { class: "mode" });
  private readonly zoom = h("button", { class: "zoom", title: "Zoom to 100% (Ctrl+0)" });
  private readonly undo: HTMLButtonElement;
  private readonly snap = h(
    "button",
    {
      class: "button",
      type: "button",
      title: "Snap to the grid and to other elements (Alt turns it off while dragging)",
      "aria-label": "Snap to the grid and to other elements",
    },
    icon("snap"),
  );
  private readonly redo: HTMLButtonElement;
  private readonly stage: HTMLElement;
  private readonly toasts = h("div", { class: "toasts", role: "status" });
  private readonly tree = h("div", { class: "tree", role: "tree", "aria-label": "Elements" });
  private readonly empty = h(
    "div",
    { class: "empty" },
    h("strong", {}, "An empty diagram"),
    h("span", {}, "Drag a shape here from the left, or double-click for an agent."),
  );
  private shown = "";
  private inspected = "";
  private sync: (() => void)[] = [];
  private typing: number | undefined;

  constructor(root: HTMLElement, stage: HTMLElement, editor: Editor, shell: Shell) {
    this.editor = editor;
    this.shell = shell;
    this.stage = stage;
    const button = (name: keyof typeof ICONS, title: string, run: () => void, label?: string) =>
      h("button", { class: "button", title, "aria-label": title, onClick: run }, icon(name), label);
    this.undo = button("undo", "Undo (Ctrl+Z)", () => editor.doc.undo());
    this.redo = button("redo", "Redo (Ctrl+Shift+Z)", () => editor.doc.redo());
    this.zoom.addEventListener("click", () => editor.view.zoomTo(1));
    this.snap.addEventListener("click", () => {
      editor.snapping = !editor.snapping;
      editor.view.grid = editor.snapping;
      editor.view.invalidate();
      this.update();
    });
    const examples = h(
      "select",
      {
        class: "select",
        title: "Open an example",
        "aria-label": "Open an example",
        onChange: (event: Event) => {
          const select = event.target as HTMLSelectElement,
            found = TAM_EXAMPLES.find(([name]) => name === select.value);
          select.value = "";
          if (found) shell.openExample(found[1]);
        },
      },
      h("option", { value: "" }, "Examples…"),
      ...TAM_EXAMPLES.filter(([name]) => !name.startsWith("error")).map(([name]) =>
        h("option", { value: name }, name),
      ),
    );
    const bar = h(
      "header",
      { class: "bar" },
      h("div", { class: "brand" }, icon("logo"), h("span", {}, "TAM Editor")),
      h(
        "div",
        { class: "cluster" },
        button("file", "New diagram", () => shell.newDiagram(), "New"),
        button("open", "Open a .tam file", () => shell.openFile(), "Open"),
        button("save", "Save as a .tam file (Ctrl+S)", () => shell.saveFile(), "Save"),
        examples,
      ),
      h("div", { class: "cluster" }, this.undo, this.redo),
      h(
        "div",
        { class: "cluster" },
        this.mode,
        button(
          "layout",
          "Lay the diagram out automatically: clears every position",
          () => void editor.autoLayout(),
          "Auto layout",
        ),
      ),
      h("div", { class: "spacer" }),
      h(
        "div",
        { class: "cluster" },
        button("minus", "Zoom out (−)", () => editor.view.zoomBy(0.8)),
        this.zoom,
        button("plus", "Zoom in (+)", () => editor.view.zoomBy(1.25)),
        button("fit", "Fit the diagram (1)", () => editor.fit()),
        this.snap,
      ),
      h(
        "div",
        { class: "cluster" },
        button("image", "Export as SVG", () => shell.exportSvg(), "SVG"),
        button("image", "Export as PNG", () => shell.exportPng(), "PNG"),
        button("copy", "Copy the source", () => shell.copySource()),
        button("theme", "Light or dark", () => shell.toggleTheme()),
      ),
    );
    const tools = this.palette(root);
    this.source.addEventListener("input", () => {
      // The picture follows the typing after a pause.
      window.clearTimeout(this.typing);
      this.typing = window.setTimeout(() => void editor.doc.apply(this.source.value), 200);
    });
    this.source.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      this.source.setRangeText("  ", this.source.selectionStart, this.source.selectionEnd, "end");
      this.source.dispatchEvent(new Event("input"));
    });
    const side = h(
      "aside",
      { class: "side" },
      h("section", { class: "pane" }, this.inspector),
      h(
        "section",
        { class: "pane grow" },
        h("h2", {}, "Source"),
        this.source,
        this.problem,
        this.warning,
      ),
    );
    stage.append(this.empty, this.toasts);
    root.append(bar, tools, stage, side, h("footer", { class: "status" }, this.status));
    editor.notify = (message) => this.toast(message);
    editor.onMenu = (at, point) => this.menu(at, point);
    editor.editText = (box, text, options, done) => this.editText(box, text, options, done);
    editor.view.onView = () => this.showZoom();
    this.showZoom();
  }

  /** The left panel: the pointer tools, the shapes to drag onto the canvas, and the tree of the diagram. */
  private palette(root: HTMLElement): HTMLElement {
    const { editor, shell } = this;
    const item = (entry: ToolItem, shape: boolean) => {
      const title = [entry.name, entry.key && `(${entry.key})`, entry.hint && `· ${entry.hint}`]
        .filter(Boolean)
        .join(" ");
      const control = h(
        "button",
        { class: shape ? "tool shape" : "tool", title, "aria-label": title, type: "button" },
        icon(entry.icon),
        h("span", { class: "name" }, entry.name),
        entry.key && h("kbd", {}, entry.key),
      );
      this.tools.set(entry.tool, control);
      if (shape) this.draggable(control, entry);
      else control.addEventListener("click", () => editor.setTool(entry.tool));
      return control;
    };
    const fold = h(
      "button",
      {
        class: "tool fold",
        type: "button",
        title: "Show or hide the names and the tree",
        "aria-label": "Show or hide the names and the tree",
        onClick: () => {
          const compact = root.classList.toggle("compact");
          shell.remember("palette", compact ? "compact" : "wide");
          requestAnimationFrame(() => editor.view.invalidate());
        },
      },
      icon("fold"),
    );
    root.classList.toggle("compact", shell.recall("palette") === "compact");
    // The tree takes drops: onto an element, or onto its ground for the top level.
    this.tree.addEventListener("dragover", (event) => {
      if (
        event.target === this.tree &&
        this.dragged.length &&
        editor.allowsMove(this.dragged, null)
      )
        event.preventDefault();
    });
    this.tree.addEventListener("drop", (event) => {
      if (event.target !== this.tree) return;
      event.preventDefault();
      editor.moveElements(this.dragged, null);
    });
    return h(
      "nav",
      { class: "tools", "aria-label": "Tools and shapes" },
      h("div", { class: "pointers" }, ...POINTERS.map((entry) => item(entry, false)), fold),
      ...SHAPES.flatMap((group) => {
        const title = h("h2", {}, group.title),
          shapes = h("div", { class: "shapes" }, ...group.items.map((entry) => item(entry, true)));
        this.groups.push({ title, shapes, items: group.items });
        return [title, shapes];
      }),
      h("h2", { class: "outline" }, "Elements"),
      this.tree,
    );
  }

  /**
   * A shape of the palette: a click picks it as the tool, to place with a click on the canvas; a
   * drag carries it there, shown where it would stand.
   */
  private draggable(control: HTMLElement, entry: ToolItem) {
    const { editor } = this,
      kind = entry.tool as ElementKind;
    let start: { x: number; y: number } | undefined, chip: HTMLElement | undefined;
    const over = (event: PointerEvent) => {
      const rect = editor.view.canvas.getBoundingClientRect();
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    };
    const end = () => {
      start = undefined;
      chip?.remove();
      chip = undefined;
      editor.showGhost(kind, undefined);
    };
    control.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      control.setPointerCapture(event.pointerId);
    });
    control.addEventListener("pointermove", (event) => {
      if (!start) return;
      if (!chip && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
      chip ??= document.body.appendChild(
        h("div", { class: "chip" }, icon(entry.icon), h("span", {}, entry.name)),
      );
      // Over the canvas the element shows where it would stand; on the way there, as a chip.
      const on = over(event);
      chip.hidden = on;
      chip.style.transform = `translate(${event.clientX + 10}px, ${event.clientY + 10}px)`;
      editor.showGhost(
        kind,
        on ? editor.view.toScene(editor.view.pointOf(event)) : undefined,
        event.altKey,
      );
    });
    control.addEventListener("pointerup", (event) => {
      const dragged = !!chip,
        on = over(event);
      end();
      if (!dragged) editor.setTool(editor.tool === kind ? "select" : kind);
      else if (on)
        editor.create(kind, editor.view.toScene(editor.view.pointOf(event)), event.altKey);
    });
    control.addEventListener("pointercancel", end);
  }

  /** The groups of shapes in the palette, shown as far as the diagram takes their shapes. */
  private groups: { title: HTMLElement; shapes: HTMLElement; items: ToolItem[] }[] = [];

  /** The elements of the tree that are closed: their parts do not show. */
  private folded = new Set<string>();

  /** The elements being dragged in the tree. */
  private dragged: string[] = [];

  /** The tree of the diagram: a click selects, a double click names, a drag puts an element inside another. */
  private showTree() {
    const { editor } = this,
      items = editor.tree,
      selected = new Set(editor.selectedElements);
    // Built again only when it shows something else: a row under the pointer stays the row it was.
    const key = JSON.stringify([items, [...selected], [...this.folded]]);
    if (key === this.shown) return;
    this.shown = key;
    const row = (item: TreeItem, depth: number): HTMLElement[] => {
      const folded = this.folded.has(item.id),
        parent = item.children.length > 0;
      // An element that holds others opens and closes; the others keep the room of the arrow.
      const twist = h(
        "span",
        parent
          ? {
              class: "twist",
              role: "button",
              "aria-label": folded ? "Expand" : "Collapse",
              "aria-expanded": String(!folded),
              onClick: (event: Event) => {
                event.stopPropagation();
                if (folded) this.folded.delete(item.id);
                else this.folded.add(item.id);
                this.showTree();
              },
              onDblclick: (event: Event) => event.stopPropagation(),
            }
          : { class: "twist none" },
        parent && icon("chevron"),
      );
      const line = h(
        "div",
        {
          class: "node",
          role: "treeitem",
          draggable: "true",
          "aria-selected": String(selected.has(item.id)),
          ...(parent ? { "aria-expanded": String(!folded) } : {}),
          style: `padding-left:${4 + depth * 14}px`,
          title: `${item.kind} ${item.id}`,
        },
        twist,
        icon(item.kind),
        h(
          "span",
          { class: "name" },
          item.label.replace(/<br\s*\/?>/gi, " ") || item.id.replace(/#.*/, ""),
        ),
      );
      line.addEventListener("click", (event) => {
        const part = { type: "element" as const, id: item.id };
        editor.select(
          event.shiftKey || event.ctrlKey || event.metaKey
            ? editor.isSelected(part)
              ? editor.selection.filter((other) => other.id !== item.id)
              : [...editor.selection, part]
            : [part],
        );
        editor.reveal(item.id);
      });
      line.addEventListener("dblclick", () => editor.rename(item.id));
      line.addEventListener("dragstart", (event) => {
        this.dragged = selected.has(item.id) ? [...selected] : [item.id];
        event.dataTransfer?.setData("text/plain", this.dragged.join(" "));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      line.addEventListener("dragend", () => {
        this.dragged = [];
      });
      line.addEventListener("dragover", (event) => {
        if (!this.dragged.length || !editor.allowsMove(this.dragged, item.id)) return;
        event.preventDefault();
        line.classList.add("over");
      });
      line.addEventListener("dragleave", () => line.classList.remove("over"));
      line.addEventListener("drop", (event) => {
        event.preventDefault();
        line.classList.remove("over");
        editor.moveElements(this.dragged, item.id);
      });
      return [line, ...(folded ? [] : item.children.flatMap((child) => row(child, depth + 1)))];
    };
    this.tree.replaceChildren(
      ...(items.length
        ? items.flatMap((item) => row(item, 0))
        : [h("p", { class: "note" }, "No elements yet.")]),
    );
  }

  private showZoom() {
    this.zoom.textContent = `${Math.round(this.editor.view.zoom * 100)}%`;
  }

  /** The menu of a right click: what can be done with the selection, or at the point on the empty canvas. */
  private menu(at: { x: number; y: number }, point: { x: number; y: number }) {
    const { editor } = this,
      elements = editor.selectedElements,
      wires = editor.selectedWires;
    document.querySelector(".menu")?.remove();
    const menu = h("div", { class: "menu", role: "menu" });
    const close = () => {
      menu.remove();
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape, true);
    };
    const outside = (event: Event) => {
      if (!menu.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const item = (
      name: string,
      run: () => void,
      options: { key?: string; danger?: boolean } = {},
    ) =>
      h(
        "button",
        {
          class: options.danger ? "danger" : "",
          type: "button",
          role: "menuitem",
          onClick: () => {
            close();
            run();
          },
        },
        h("span", {}, name),
        options.key && h("kbd", {}, options.key),
      );
    const line = () => h("hr");
    const clip = (cut: boolean) => {
      const text = editor.copy();
      if (text === undefined) return;
      void navigator.clipboard?.writeText(text).catch(() => {});
      if (cut) editor.deleteSelection();
    };
    const paste = () =>
      void (navigator.clipboard?.readText() ?? Promise.reject(new Error("No clipboard.")))
        .catch(() => editor.copiedText ?? "")
        .then((text) => text && editor.paste(text));
    const rows: (HTMLElement | false)[] = [];
    if (elements.length) {
      // Only the boxes that may hold what is selected are offered.
      const boxes = (
        [
          ["agent", "Put in an agent", "Ctrl+G"],
          ["storage", "Put in a storage", ""],
          ["component", "Put in a component", ""],
          ["subsystem", "Put in a subsystem", ""],
          ["package", "Put in a package", ""],
          ["group", "Put in a group", "Ctrl+Shift+G"],
        ] as [ElementKind, string, string][]
      ).filter(([kind]) => editor.allowsWrap(kind));
      rows.push(
        ...boxes.map(([kind, name, key]) => item(name, () => editor.wrapSelection(kind), { key })),
        !!editor.selectionHolder && item("Take out of its box", () => editor.takeOut()),
        (boxes.length > 0 || !!editor.selectionHolder) && line(),
        elements.length === 1 && item("Rename", () => editor.rename(elements[0]), { key: "Enter" }),
        item("Duplicate", () => editor.duplicateSelection(), { key: "Ctrl+D" }),
        item("Copy", () => clip(false), { key: "Ctrl+C" }),
        item("Cut", () => clip(true), { key: "Ctrl+X" }),
        line(),
        item("Delete", () => editor.deleteSelection(), { key: "Del", danger: true }),
      );
    } else if (wires.length) {
      const [id] = wires,
        connection = wires.length === 1 ? editor.connection(id) : undefined;
      // The other kinds this connection may be, between the elements it joins.
      const kinds = connection
        ? WIRES.filter(
            (kind) =>
              kind.value !== wireValue(connection) && editor.allowsWire(id, wireChange(kind)),
          )
        : [];
      rows.push(
        ...kinds.map((kind) =>
          item(`Change to: ${kind.name}`, () => editor.setWire(id, wireChange(kind))),
        ),
        kinds.length > 0 && line(),
        wires.length === 1 &&
          editor.allowsWire(id, { reverse: true }) &&
          item("Reverse", () => editor.setWire(id, { reverse: true })),
        item("Delete", () => editor.deleteSelection(), { key: "Del", danger: true }),
      );
    } else {
      const kinds = (["agent", "human", "storage"] as ElementKind[]).filter((kind) =>
        editor.allowsKind(kind),
      );
      rows.push(
        ...kinds.map((kind) => item(`Add ${kind} here`, () => editor.create(kind, point))),
        kinds.length > 0 && line(),
        item("Paste", paste, { key: "Ctrl+V" }),
        item("Select all", () => editor.selectAll(), { key: "Ctrl+A" }),
        item("Fit the diagram", () => editor.fit(), { key: "1" }),
      );
    }
    menu.append(...rows.filter((row) => row !== false));
    document.body.append(menu);
    // Inside the window, whichever corner the click was near.
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(at.x, window.innerWidth - width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(at.y, window.innerHeight - height - 4))}px`;
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
  }

  /** Says something for a few seconds. */
  toast(message: string) {
    const note = h("div", { class: "toast" }, message);
    this.toasts.replaceChildren(note);
    window.setTimeout(() => note.remove(), 5000);
  }

  /** A text field over a box of the diagram: Enter takes the text, Escape leaves it. */
  private editText(
    box: Box,
    text: string,
    options: { size: number; weight: number },
    done: (text: string | undefined) => void,
  ) {
    const { view } = this.editor,
      on = view.boxOnScreen(box),
      size = options.size * view.zoom;
    const field = h("textarea", { class: "label-edit", spellcheck: "false", rows: "1" });
    field.value = text;
    const lines = () => Math.max(1, field.value.split("\n").length);
    const fit = () => {
      const height = Math.max(on.height, lines() * size * 1.3 + 8);
      Object.assign(field.style, {
        left: `${on.x - 20}px`,
        top: `${on.y + on.height / 2 - height / 2}px`,
        width: `${Math.max(on.width + 40, 120)}px`,
        height: `${height}px`,
        fontSize: `${size}px`,
        fontWeight: String(options.weight),
        paddingTop: `${Math.max(0, (height - lines() * size * 1.3) / 2)}px`,
      });
    };
    fit();
    let open = true;
    const close = (result: string | undefined) => {
      if (!open) return;
      open = false;
      field.remove();
      done(result);
    };
    field.addEventListener("input", fit);
    field.addEventListener("blur", () => close(field.value));
    field.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        close(field.value);
      } else if (event.key === "Escape") close(undefined);
    });
    this.stage.append(field);
    field.focus();
    field.select();
  }

  /** Shows the editor's state: called whenever it changed. */
  update() {
    const { editor } = this,
      { doc } = editor;
    // Only the shapes the diagram takes are offered: a conceptual one has no components.
    for (const group of this.groups) {
      let any = false;
      for (const entry of group.items) {
        const allowed = !!doc.problem || editor.allowsKind(entry.tool as ElementKind);
        this.tools.get(entry.tool)!.hidden = !allowed;
        any ||= allowed;
        if (!allowed && editor.tool === entry.tool) editor.tool = "select";
      }
      group.title.hidden = group.shapes.hidden = !any;
    }
    for (const [tool, control] of this.tools)
      control.setAttribute("aria-pressed", String(tool === editor.tool));
    this.snap.setAttribute("aria-pressed", String(editor.snapping));
    this.undo.disabled = !doc.canUndo;
    this.redo.disabled = !doc.canRedo;
    if (this.source.value !== doc.source && document.activeElement !== this.source)
      this.source.value = doc.source;
    this.problem.textContent = doc.problem?.message ?? "";
    this.problem.hidden = !doc.problem;
    // Not an error of the source, but not TAM either: elements that lie on each other.
    const [pair] = doc.picture?.overlaps ?? [],
      names = pair?.map((id) => {
        const node = doc.picture!.diagram.nodes.get(id);
        return (node?.label || node?.origin || id).replace(/<br\s*\/?>/gi, " ");
      });
    this.warning.textContent = names
      ? `“${names[0]}” and “${names[1]}” overlap. TAM places all elements apart.`
      : "";
    this.warning.hidden = !names || !!doc.problem;
    const placed = doc.picture?.placed && doc.picture.diagram.nodes.size > 0;
    this.mode.textContent = placed ? "Placed by hand" : "Automatic layout";
    this.mode.title = placed
      ? "Elements stand where the source places them (@x,y)"
      : "No element is placed: the layout is automatic until one is moved";
    this.status.textContent =
      HINTS[editor.tool] ?? "Click to place the element · inside another element to put it there";
    this.empty.hidden = !!doc.problem || !doc.picture || doc.picture.diagram.nodes.size > 0;
    this.showTree();
    this.inspect();
  }

  // The inspector: what is selected, with its properties.

  private inspect() {
    const { editor } = this,
      elements = editor.selectedElements,
      wires = editor.selectedWires;
    const key = editor.selection.map((part) => `${part.type}:${part.id}`).join(" ");
    if (key !== this.inspected || !this.inspector.childElementCount) {
      this.inspected = key;
      this.sync = [];
      this.inspector.replaceChildren(
        ...(wires.length === 1 && !elements.length
          ? this.wirePane(wires[0])
          : elements.length
            ? this.elementPane(elements)
            : editor.selection.length
              ? this.manyPane()
              : this.diagramPane()),
      );
    }
    for (const sync of this.sync) sync();
  }

  /** A labelled row of the inspector. */
  private row(label: string, control: HTMLElement) {
    return h("label", { class: "row" }, h("span", {}, label), control);
  }

  /** A text field that takes its value when it loses focus or on Enter, and shows `read()` otherwise. */
  private text(
    read: () => string,
    write: (value: string) => void,
    placeholder = "",
    multiline = false,
  ) {
    const field = multiline
      ? h("textarea", { class: "field", rows: "2", placeholder, spellcheck: "false" })
      : h("input", { class: "field", type: "text", placeholder, spellcheck: "false" });
    const commit = () => {
      if (field.value !== read()) write(field.value);
    };
    field.addEventListener("change", commit);
    field.addEventListener("keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Enter" && !(multiline && (event as KeyboardEvent).shiftKey)) {
        event.preventDefault();
        field.blur();
      } else if (key === "Escape") {
        field.value = read();
        field.blur();
      }
    });
    this.sync.push(() => {
      if (document.activeElement !== field) field.value = read();
    });
    return field;
  }

  private choice<T extends string>(
    options: { value: T; name: string }[],
    read: () => T | "",
    write: (value: T) => void,
    allowed: (value: T) => boolean = () => true,
  ) {
    const items = options.map((option) => h("option", { value: option.value }, option.name));
    const select = h(
      "select",
      { class: "field", onChange: () => write(select.value as T) },
      ...items,
    ) as HTMLSelectElement;
    this.sync.push(() => {
      // Only what the notation allows here is offered, and what is set.
      const current = read();
      select.replaceChildren(
        ...items.filter((item) => item.value === current || allowed(item.value as T)),
      );
      select.value = current;
    });
    return select;
  }

  /** Buttons of which one is on. */
  private segments<T extends string>(
    options: { value: T; name: string; title?: string }[],
    read: () => T | undefined,
    write: (value: T) => void,
    allowed: (value: T) => boolean = () => true,
  ) {
    const controls = options.map((option) =>
      h(
        "button",
        {
          class: "segment",
          type: "button",
          title: option.title,
          onClick: () => write(option.value),
        },
        option.name,
      ),
    );
    this.sync.push(() =>
      controls.forEach((control, index) => {
        const on = options[index].value === read();
        control.setAttribute("aria-pressed", String(on));
        control.disabled = !on && !allowed(options[index].value);
      }),
    );
    return h("div", { class: "segments" }, ...controls);
  }

  private elementPane(ids: string[]): HTMLElement[] {
    const { editor } = this;
    const nodes = () =>
      ids.flatMap((id) => {
        const node = editor.doc.picture?.diagram.nodes.get(id);
        return node ? [node] : [];
      });
    const shared = <T>(read: (node: ReturnType<typeof nodes>[number]) => T): T | undefined => {
      const values = new Set(nodes().map(read));
      return values.size === 1 ? [...values][0] : undefined;
    };
    const [id] = ids,
      single = ids.length === 1;
    const colors = ["", ...COLORS].map((color) => {
      const swatch = h("button", {
        class: `swatch ${color || "none"}`,
        type: "button",
        title: color || "No color",
        "aria-label": color || "No color",
        onClick: () => editor.setElements({ color: color || null }),
      });
      this.sync.push(() =>
        swatch.setAttribute(
          "aria-pressed",
          String((shared((node) => node.color ?? "") ?? "?") === color),
        ),
      );
      return swatch;
    });
    const multiple = (node: ReturnType<typeof nodes>[number]) =>
      node.stack
        ? "stack"
        : editor.doc.picture?.diagram.nodes.has(`${node.id}#2`)
          ? "several"
          : "one";
    const name = h("input", { class: "field", type: "text", placeholder: "IName" });
    const offer = (offers: "provides" | "requires") =>
      h(
        "button",
        {
          class: "button small",
          type: "button",
          onClick: () => {
            if (!name.value.trim()) return name.focus();
            editor.addInterface(id, offers, name.value);
            name.value = "";
          },
        },
        offers,
      );
    const interfaces = h(
      "div",
      { class: "row" },
      h("span", {}, "Interface"),
      h("div", { class: "inline" }, name, offer("provides"), offer("requires")),
    );
    // Only elements that act offer interfaces.
    this.sync.push(() => {
      interfaces.hidden = !editor.allowsInterface(id);
    });
    // Aligning and spreading need several elements; sizes can be made one, or left to the contents.
    const act = (name: keyof typeof ICONS, title: string, run: () => void, least = 2) => {
      const control = h(
        "button",
        { class: "tool mini", type: "button", title, "aria-label": title, onClick: run },
        icon(name),
      );
      control.hidden = ids.length < least;
      return control;
    };
    const arrangement = h(
      "div",
      { class: "arrange" },
      act("align-left", "Align left edges", () => editor.arrange("left")),
      act("align-center", "Align centers", () => editor.arrange("center")),
      act("align-right", "Align right edges", () => editor.arrange("right")),
      act("align-top", "Align top edges", () => editor.arrange("top")),
      act("align-middle", "Align middles", () => editor.arrange("middle")),
      act("align-bottom", "Align bottom edges", () => editor.arrange("bottom")),
      act("spread-x", "Spread evenly, left to right", () => editor.arrange("spread-x"), 3),
      act("spread-y", "Spread evenly, top to bottom", () => editor.arrange("spread-y"), 3),
      act("same-width", "Make as wide as the widest", () => editor.sameSize("width")),
      act("same-height", "Make as high as the highest", () => editor.sameSize("height")),
      act("fit-size", "Fit the size to the name, or to what is inside", () => editor.fitSize(), 1),
    );
    // Shown as two with dots between, the copy stands beside or below; dragging it puts it anywhere.
    const copyRow = h(
      "div",
      { class: "row" },
      h("span", {}, "Copy"),
      this.segments<"beside" | "below">(
        [
          { value: "beside", name: "Beside", title: "A … B, side by side" },
          { value: "below", name: "Below", title: "A … B, one above the other" },
        ],
        () => editor.copySide(id),
        (side) => editor.placeCopy(id, side),
      ),
    );
    this.sync.push(() => {
      copyRow.hidden = !editor.doc.picture?.diagram.nodes.has(`${id}#2`);
    });
    const rows: (HTMLElement | false)[] = [
      h("h2", {}, single ? "Element" : `${ids.length} elements`),
      single &&
        this.row(
          "Name",
          this.text(
            () => (nodes()[0]?.label ?? "").replace(/<br\s*\/?>/gi, "\n"),
            (label) => editor.setElements({ label }),
            "Name",
            true,
          ),
        ),
      this.row(
        "Kind",
        this.choice(
          ELEMENT_KINDS.map((kind) => ({ value: kind, name: kind })),
          () => (shared((node) => node.kind) ?? "") as ElementKind | "",
          (kind) => editor.setElements({ kind }),
          (kind) => editor.allowsElements({ kind }),
        ),
      ),
      h(
        "div",
        { class: "row" },
        h("span", {}, "Color"),
        h("div", { class: "swatches" }, ...colors),
      ),
      h(
        "div",
        { class: "row" },
        h("span", {}, "Count"),
        this.segments(
          [
            { value: "one", name: "One" },
            { value: "stack", name: "Stack", title: "Several, drawn as a stack" },
            { value: "several", name: "A … B", title: "Several, drawn as two with dots between" },
          ],
          () => shared(multiple),
          (value) =>
            editor.setElements({ stack: value === "stack", multiple: value === "several" }),
          (value) =>
            editor.allowsElements({ stack: value === "stack", multiple: value === "several" }),
        ),
      ),
      h("div", { class: "row top" }, h("span", {}, "Arrange"), arrangement),
      single && copyRow,
      single && interfaces,
      single && h("div", { class: "row quiet" }, h("span", {}, "Id"), h("code", {}, id)),
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          { class: "button", type: "button", onClick: () => editor.duplicateSelection() },
          "Duplicate",
        ),
        h(
          "button",
          { class: "button danger", type: "button", onClick: () => editor.deleteSelection() },
          "Delete",
        ),
      ),
    ];
    return rows.filter((item) => item !== false);
  }

  private wirePane(id: string): HTMLElement[] {
    const { editor } = this,
      read = () => editor.connection(id);
    const remove = h(
      "div",
      { class: "actions" },
      h(
        "button",
        { class: "button danger", type: "button", onClick: () => editor.deleteSelection() },
        "Delete",
      ),
    );
    if (!read())
      return [
        h("h2", {}, "Interface"),
        h(
          "p",
          { class: "note" },
          "An interface an element provides or requires. Its name is set in the source.",
        ),
        remove,
      ];
    const channel = () => ["calls", "sends data", "---", "requires"].includes(read()?.word ?? "");
    const both = h("input", {
      type: "checkbox",
      onChange: () => editor.setWire(id, { both: both.checked }),
    }) as HTMLInputElement;
    const bothRow = h("label", { class: "row check" }, h("span", {}, "Both ways"), both);
    const label = this.row(
      "Label",
      this.text(
        () => (read()?.word === "dependency" ? "" : (read()?.label ?? "")),
        (text) => editor.setWire(id, { label: text }),
        "What is sent or asked",
      ),
    );
    const protocol = this.row(
      "Protocol",
      this.text(
        () => read()?.protocol ?? "",
        (text) => editor.setWire(id, { protocol: text }),
        "HTTPS, RFC, …",
      ),
    );
    const ends = h("p", { class: "note" });
    const reverse = h(
      "button",
      { class: "button", type: "button", onClick: () => editor.setWire(id, { reverse: true }) },
      "Reverse",
    );
    this.sync.push(() => {
      const connection = read();
      both.checked = !!connection?.both;
      bothRow.hidden = !connection?.both && !editor.allowsWire(id, { both: true });
      reverse.disabled = !editor.allowsWire(id, { reverse: true });
      label.hidden = connection?.word === "dependency";
      protocol.hidden = !channel();
      ends.textContent = connection ? `${connection.from} → ${connection.to}` : "";
    });
    return [
      h("h2", {}, "Connection"),
      ends,
      this.row(
        "Kind",
        this.choice(
          WIRES,
          () => {
            const connection = read();
            return connection ? wireValue(connection) : "";
          },
          (value) => {
            const kind = WIRES.find((item) => item.value === value)!;
            editor.setWire(id, wireChange(kind));
          },
          (value) => editor.allowsWire(id, wireChange(WIRES.find((item) => item.value === value)!)),
        ),
      ),
      bothRow,
      label,
      protocol,
      h(
        "div",
        { class: "actions" },
        reverse,
        h(
          "button",
          { class: "button danger", type: "button", onClick: () => editor.deleteSelection() },
          "Delete",
        ),
      ),
    ];
  }

  private manyPane(): HTMLElement[] {
    const { editor } = this;
    return [
      h("h2", {}, `${editor.selection.length} selected`),
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          { class: "button danger", type: "button", onClick: () => editor.deleteSelection() },
          "Delete",
        ),
      ),
    ];
  }

  private diagramPane(): HTMLElement[] {
    const { editor } = this,
      diagram = () => editor.doc.picture?.diagram;
    return [
      h("h2", {}, "Diagram"),
      this.row(
        "Title",
        this.text(
          () => diagram()?.title ?? "",
          (title) => editor.setHeader({ title }),
          "Untitled",
        ),
      ),
      h(
        "div",
        { class: "row" },
        h("span", {}, "Direction"),
        this.segments<Direction>(
          [
            { value: "TB", name: "↓", title: "Top to bottom" },
            { value: "LR", name: "→", title: "Left to right" },
            { value: "BT", name: "↑", title: "Bottom to top" },
            { value: "RL", name: "←", title: "Right to left" },
          ],
          () => diagram()?.direction,
          (direction) => editor.setHeader({ direction }),
        ),
      ),
      h(
        "div",
        { class: "row" },
        h("span", {}, "Level"),
        this.segments<"" | "conceptual" | "design">(
          [
            { value: "", name: "Any", title: "Agents and components side by side" },
            {
              value: "conceptual",
              name: "Conceptual",
              title: "Agents, storages and channels only",
            },
            { value: "design", name: "Design", title: "Components, interfaces and connectors" },
          ],
          () => diagram()?.level ?? "",
          (level) => editor.setHeader({ level }),
          (level) => editor.allowsHeader({ level }),
        ),
      ),
      h(
        "p",
        { class: "note" },
        "Pick a tool on the left and click the canvas, or double-click it for an agent. ",
        "Positions are written into the source as ",
        h("code", {}, "@x,y"),
        "; without them the layout is automatic.",
      ),
    ];
  }
}
