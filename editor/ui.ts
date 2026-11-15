/**
 * The editor's window around the canvas: the bar with the menus and the document's title, the tool
 * rail, the left panel (shapes and outline), the right panel (properties and source), the status
 * bar, and what lies over the canvas (notices, the banner of an error, the minimap).
 */

import type { Box } from "../src/scene.ts";
import { chooser, helpDialog, syntaxDialog } from "./dialogs.ts";
import { h, icon, iconButton, prose, setOff, tipped } from "./dom.ts";
import type { Editor, Tool, TreeItem } from "./editor.ts";
import type { IconName } from "./icons.ts";
import { Inspector } from "./inspector.ts";
import { menuButton, popup } from "./menu.ts";
import { type Bench, Menus, type PanelName, type Shell } from "./menus.ts";
import { Minimap } from "./minimap.ts";
import { Outline, within } from "./outline.ts";
import { Palette } from "./palette.ts";
import { SourcePane } from "./source.ts";
import { StatusBar } from "./statusbar.ts";
import { installTooltips } from "./tooltip.ts";
import { typeInfo } from "./types.ts";

/** The pointer tools of the rail. */
const POINTERS: { tool: Tool; icon: IconName; name: string; key: string }[] = [
  { tool: "select", icon: "select", name: "Select, move and resize", key: "V" },
  { tool: "pan", icon: "pan", name: "Pan: move the view", key: "H" },
  { tool: "connect", icon: "connect", name: "Connect: drag from one element to another", key: "C" },
];

/** The widths the panels start with and may be dragged to, and the widths of the window below which they lie over the canvas. */
const LEFT = { start: 240, least: 200, most: 360 },
  RIGHT = { start: 320, text: 480, least: 280, most: 560 },
  NARROW = 1000,
  TINY = 860;

/** A step to take back or go on with, offered in a notice. */
export interface ToastAction {
  name: string;
  run(): void;
}

export class Panels {
  private readonly root: HTMLElement;
  private readonly editor: Editor;
  private readonly shell: Shell;
  private readonly stage: HTMLElement;
  private readonly menus: Menus;
  private readonly status: StatusBar;
  private readonly palette: Palette;
  private readonly outline: Outline;
  private readonly inspector: Inspector;
  private readonly minimap: Minimap;
  private readonly source: SourcePane;
  /** The lines marked in the source, to mark them again only when they changed. */
  private lines = "";
  /** Set while typed text waits to become the document. */
  private typing: number | undefined;

  // The bar.
  private readonly title = h("input", {
    type: "text",
    spellcheck: "false",
    placeholder: "Untitled",
    "aria-label": "Title of the diagram",
  });
  private readonly titleBox = h("label", { class: "doc-title" }, this.title);
  private readonly chip = h("button", { class: "chip", type: "button" });
  private readonly dot = h("span", { class: "unsaved", ...tipped({ tip: "Unsaved changes" }) });
  private readonly arrangeTitle: HTMLElement;
  private readonly undo: HTMLButtonElement;
  private readonly redo: HTMLButtonElement;

  // The rail and the panels.
  private readonly tools = new Map<Tool, HTMLButtonElement>();
  private readonly toggles = new Map<"shapes" | "outline" | "side", HTMLButtonElement>();
  private readonly tabs = new Map<"shapes" | "outline", HTMLButtonElement>();
  private readonly leftPanel: HTMLElement;
  private readonly sidePanel: HTMLElement;
  private readonly sections = new Map<"properties" | "source", HTMLElement>();
  private readonly wrap: HTMLButtonElement;
  private readonly problem = h("button", { class: "problem", type: "button" });
  private readonly warning = h("div", { class: "problem warning", role: "status" });
  private readonly problems = h("span", { class: "count" });

  // Over the canvas.
  private readonly toasts = h("div", { class: "toasts", role: "status" });
  private readonly banner = h("button", { class: "banner", type: "button" });
  private readonly preview = h("div", { class: "preview-label" }, "Preview");
  private readonly empty = h("div", { class: "empty" });

  // How the window is laid out.
  /** The tab of the left panel on show; none when the panel is closed. */
  private left: "shapes" | "outline" | "" = "shapes";
  /** Whether the right panel shows. */
  private side = true;
  private readonly open = { properties: true, source: true };
  private readonly widths = { left: LEFT.start, right: RIGHT.start };
  /** The height of the Properties section while Source shows below it. */
  private split = 300;
  /** The window is too small for the left panel, or for both panels, beside the canvas: they lie over it. */
  private narrow = false;
  private tiny = false;
  /** Whether the diagram on show is edited as text; undefined before the first one shows. */
  private text: boolean | undefined;

  constructor(root: HTMLElement, stage: HTMLElement, editor: Editor, shell: Shell) {
    this.root = root;
    this.editor = editor;
    this.shell = shell;
    this.stage = stage;
    installTooltips();
    const bench: Bench = {
      chooser: () => this.chooser(),
      help: () => helpDialog(),
      syntax: () => syntaxDialog(),
      autoLayout: () => void this.autoLayout(),
      shows: (panel) => this.shows(panel),
      toggle: (panel) => this.toggle(panel),
      toggleSnap: () => this.toggleSnap(),
      toggleGrid: () => this.toggleGrid(),
    };
    this.menus = new Menus(editor, shell, bench);
    this.status = new StatusBar(editor, {
      arrange: () => this.menus.arrange(),
      zoom: () => this.menus.zoom(),
      showProblem: () => this.showProblem(),
      toggleSnap: () => this.toggleSnap(),
    });
    this.palette = new Palette(editor, (text) => this.insert(text));
    this.outline = new Outline(editor, (at) => popup(this.menus.context({ x: 0, y: 0 }), at));
    this.inspector = new Inspector(editor);
    this.minimap = new Minimap(editor);

    // The bar: the menus, the document, and the few commands worth a button.
    this.undo = iconButton("undo", { tip: "Undo", key: "Ctrl+Z" }, () => editor.doc.undo());
    this.redo = iconButton("redo", { tip: "Redo", key: "Ctrl+Shift+Z" }, () => editor.doc.redo());
    const bar = this.menus.bar(),
      titles = bar.map(({ name }) => h("button", { class: "menu-title", type: "button" }, name)),
      shown = () => titles.filter((title) => !title.hidden);
    const opened = titles.map((title, index) =>
      menuButton(
        title,
        () =>
          this.menus
            .bar()
            .find((menu) => menu.name === bar[index].name)!
            .items(),
        {
          // The arrow keys go from menu to menu along the bar.
          step: (by) => {
            const list = shown(),
              next = list[(list.indexOf(title) + by + list.length) % list.length];
            opened[titles.indexOf(next)].open();
          },
        },
      ),
    );
    titles.forEach((title, index) =>
      // With one menu open, the pointer opens the others as it passes.
      title.addEventListener("pointerenter", () => {
        if (opened.some((menu, other) => other !== index && menu.isOpen)) opened[index].open();
      }),
    );
    this.arrangeTitle = titles[bar.findIndex((menu) => menu.name === "Arrange")];
    this.title.addEventListener("input", () => this.sizeTitle());
    this.title.addEventListener("change", () => {
      if (this.title.value.trim() !== (editor.doc.picture?.title ?? ""))
        editor.setTitle(this.title.value);
    });
    this.title.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.title.blur();
      else if (event.key === "Escape") {
        this.title.value = editor.doc.picture?.title ?? "";
        this.title.blur();
      }
    });
    this.chip.addEventListener("click", () => this.chooser());
    const exporting = h(
      "button",
      { class: "button primary", type: "button" },
      icon("export"),
      h("span", {}, "Export"),
      icon("chevron"),
    );
    menuButton(exporting, () => this.menus.exports(), { right: true });
    const header = h(
      "header",
      { class: "bar" },
      h(
        "div",
        { class: "bar-start" },
        h("span", { class: "logo", ...tipped({ tip: "TAM Editor" }) }, icon("logo")),
        h("nav", { class: "menubar", "aria-label": "Menus" }, ...titles),
      ),
      h("div", { class: "bar-doc" }, this.titleBox, this.chip, this.dot),
      h(
        "div",
        { class: "bar-end" },
        this.undo,
        this.redo,
        exporting,
        iconButton("help", { tip: "Keyboard and mouse", key: "?" }, () => helpDialog()),
      ),
    );

    // The rail: the pointer tools, then what the panels show.
    const tool = (entry: (typeof POINTERS)[number]) => {
      const control = iconButton(
        entry.icon,
        { tip: entry.name, key: entry.key, side: "right" },
        () => editor.setTool(entry.tool),
        "rail-button",
      );
      this.tools.set(entry.tool, control);
      return control;
    };
    const toggle = (
      which: "shapes" | "outline" | "side",
      name: IconName,
      tip: string,
      run: () => void,
    ) => {
      const control = iconButton(name, { tip, side: "right" }, run, "rail-button");
      this.toggles.set(which, control);
      return control;
    };
    const rail = h(
      "nav",
      { class: "rail", "aria-label": "Tools and panels" },
      ...POINTERS.map(tool),
      h("hr"),
      toggle("shapes", "shapes", "Shapes", () => this.toggle("shapes")),
      toggle("outline", "outline", "Outline", () => this.toggle("outline")),
      h("span", { class: "spacer" }),
      toggle("side", "panel", "Properties and source", () => this.toggleSide()),
    );

    // The left panel: two tabs that take its whole height.
    const tab = (which: "shapes" | "outline", name: string) => {
      const control = h(
        "button",
        { class: "tab", type: "button", role: "tab", onClick: () => this.show(which) },
        name,
      );
      this.tabs.set(which, control);
      return control;
    };
    this.leftPanel = h(
      "aside",
      { class: "left", "aria-label": "Shapes and outline" },
      h(
        "div",
        { class: "tabs", role: "tablist" },
        tab("shapes", "Shapes"),
        tab("outline", "Outline"),
        h("span", { class: "spacer" }),
        iconButton("close", { tip: "Close the panel" }, () => this.show(""), "button small"),
      ),
      this.palette.element,
      this.outline.element,
      this.resizer(
        "x",
        1,
        LEFT,
        () => this.widths.left,
        (width) => {
          this.widths.left = width;
          shell.remember("left-width", String(width));
        },
      ),
    );

    // The right panel: properties above the source, each in a place of its own.
    const sourceBox = h("div", { class: "source" });
    this.source = new SourcePane(sourceBox, {
      changed: (text) => {
        // The picture follows the typing after a pause.
        window.clearTimeout(this.typing);
        this.typing = window.setTimeout(() => {
          this.typing = undefined;
          void editor.doc.apply(text);
        }, 200);
      },
      elements: () => {
        const flat = (items: TreeItem[]): TreeItem[] =>
          items.flatMap((item) => [item, ...flat(item.children)]);
        return flat(editor.tree).filter((item) => !item.id.includes("#"));
      },
      completes: () => editor.editable,
      type: () => editor.type,
      undo: () => editor.doc.undo(),
      redo: () => editor.doc.redo(),
      cursorAt: (line) => {
        const node = [...(editor.doc.picture?.diagram.nodes.values() ?? [])].find(
          (item) => item.line === line && !item.id.includes("#"),
        );
        if (!node || editor.doc.problem || editor.doc.picture?.source !== editor.doc.source) return;
        this.lines = String(line);
        editor.select([{ type: "element", id: node.id }]);
        editor.reveal(node.id);
      },
    });
    this.wrap = iconButton(
      "wrap",
      { tip: "Wrap long lines" },
      () => this.setWrap(this.wrap.getAttribute("aria-pressed") !== "true"),
      "button small",
    );
    this.problem.addEventListener("click", () => this.showProblem());
    const section = (
      which: "properties" | "source",
      name: string,
      extras: HTMLElement[],
      ...body: HTMLElement[]
    ) => {
      const made = h(
        "section",
        { class: `section ${which}` },
        h(
          "header",
          { class: "section-header" },
          h(
            "button",
            { class: "fold", type: "button", onClick: () => this.toggle(which) },
            icon("chevron"),
            h("h2", {}, name),
          ),
          ...extras,
        ),
        ...body,
      );
      this.sections.set(which, made);
      return made;
    };
    const splitter = h("div", { class: "splitter", role: "separator" });
    this.dragging(
      splitter,
      "y",
      1,
      () => this.sections.get("properties")!.getBoundingClientRect().height,
      (height) => {
        const most = this.sidePanel.getBoundingClientRect().height - 120;
        this.split = Math.round(Math.max(80, Math.min(height, most)));
        shell.remember("split", String(this.split));
        this.arrange();
      },
    );
    this.sidePanel = h(
      "aside",
      { class: "side", "aria-label": "Properties and source" },
      this.resizer(
        "x",
        -1,
        RIGHT,
        () => this.widths.right,
        (width) => {
          this.widths.right = width;
          shell.remember(this.text ? "right-width-text" : "right-width", String(width));
        },
      ),
      section("properties", "Properties", [], this.inspector.element),
      splitter,
      section(
        "source",
        "Source",
        [this.problems, this.wrap],
        this.problem,
        this.warning,
        sourceBox,
      ),
    );

    // Over the canvas.
    this.banner.addEventListener("click", () => this.showProblem());
    stage.append(this.empty, this.preview, this.banner, this.minimap.element, this.toasts);
    // A press on the canvas puts away a panel that lies over it.
    stage.addEventListener("pointerdown", () => {
      if (this.narrow && this.left) this.show("");
      if (this.tiny && this.side) this.toggleSide();
    });
    root.append(header, rail, this.leftPanel, stage, this.sidePanel, this.status.element);

    // What was chosen on an earlier visit.
    const number = (key: string, start: number) => Number(shell.recall(key)) || start;
    this.left = { shapes: "shapes", outline: "outline", none: "" }[
      shell.recall("left") ?? "shapes"
    ] as typeof this.left;
    this.side = shell.recall("side") !== "closed";
    this.open.source = shell.recall("source-open") !== "closed";
    this.widths.left = number("left-width", LEFT.start);
    this.split = number("split", Math.round(window.innerHeight * 0.55));
    editor.snapping = shell.recall("snap") !== "off";
    editor.view.grid = shell.recall("grid") !== "off";
    this.setWrap(shell.recall("wrap") === "on");
    const sized = () => {
      const narrow = window.innerWidth < NARROW,
        tiny = window.innerWidth < TINY;
      if (narrow === this.narrow && tiny === this.tiny) return this.arrange();
      this.narrow = narrow;
      this.tiny = tiny;
      // A panel that comes to lie over the canvas starts closed; with room beside it, it is back as it was.
      this.left = narrow
        ? ""
        : ({ shapes: "shapes", outline: "outline", none: "" }[
            shell.recall("left") ?? "shapes"
          ] as typeof this.left);
      this.side = !tiny && shell.recall("side") !== "closed";
      this.arrange();
    };
    window.addEventListener("resize", sized);
    this.narrow = window.innerWidth < NARROW;
    this.tiny = window.innerWidth < TINY;
    if (this.narrow) this.left = "";
    if (this.tiny) this.side = false;

    editor.notify = (message) => this.toast(message);
    editor.onMenu = (at, point) => popup(this.menus.context(point), at);
    editor.onHelp = () => helpDialog();
    editor.onPointer = (point) => this.status.showPointer(point);
    editor.editText = (box, text, options, done) => this.editText(box, text, options, done);
    editor.view.onView = () => {
      this.status.showZoom();
      this.minimap.draw();
    };
    this.arrange();
  }

  // The layout of the window.

  /** Makes a handle drag a length: `start()` is the length at the press, `apply` takes it as the pointer moves. */
  private dragging(
    handle: HTMLElement,
    axis: "x" | "y",
    sign: 1 | -1,
    start: () => number,
    apply: (length: number) => void,
    reset?: () => void,
  ) {
    let from: { at: number; length: number } | undefined;
    const at = (event: PointerEvent) => (axis === "x" ? event.clientX : event.clientY);
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      from = { at: at(event), length: start() };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("active");
    });
    handle.addEventListener("pointermove", (event) => {
      if (from) apply(from.length + sign * (at(event) - from.at));
    });
    const end = () => {
      from = undefined;
      handle.classList.remove("active");
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    if (reset) handle.addEventListener("dblclick", reset);
  }

  /** The handle on the inner edge of a panel: a drag makes the panel wider or narrower, a double click as wide as it started. */
  private resizer(
    axis: "x",
    sign: 1 | -1,
    range: { start: number; least: number; most: number },
    read: () => number,
    write: (width: number) => void,
  ) {
    const handle = h("div", {
      class: `resizer ${sign > 0 ? "at-end" : "at-start"}`,
      role: "separator",
    });
    const set = (width: number) => {
      write(Math.round(Math.max(range.least, Math.min(width, range.most))));
      this.arrange();
    };
    this.dragging(handle, axis, sign, read, set, () => set(range.start));
    return handle;
  }

  /** Lays the window out as its state says: which panels show, how wide, and what the rail marks. */
  private arrange() {
    const { root } = this,
      left = !!this.left,
      // The canvas keeps a part of the window, whatever the panels were dragged to.
      room = Math.max(
        RIGHT.least,
        window.innerWidth - 44 - (left && !this.narrow ? this.widths.left : 0) - 240,
      ),
      right = Math.min(this.widths.right, this.tiny ? window.innerWidth - 44 : room);
    root.classList.toggle("left-over", this.narrow);
    root.classList.toggle("side-over", this.tiny);
    root.style.setProperty("--left", left && !this.narrow ? `${this.widths.left}px` : "0px");
    root.style.setProperty("--right", this.side && !this.tiny ? `${right}px` : "0px");
    this.leftPanel.style.width = `${this.widths.left}px`;
    this.sidePanel.style.width = `${right}px`;
    this.leftPanel.hidden = !left;
    this.sidePanel.hidden = !this.side;
    for (const [which, control] of this.tabs)
      control.setAttribute("aria-selected", String(this.left === which));
    this.palette.element.hidden = this.left !== "shapes";
    this.outline.element.hidden = this.left !== "outline";
    this.toggles.get("shapes")!.setAttribute("aria-pressed", String(this.left === "shapes"));
    this.toggles.get("outline")!.setAttribute("aria-pressed", String(this.left === "outline"));
    this.toggles.get("side")!.setAttribute("aria-pressed", String(this.side));
    // Properties keeps its height above the source; alone, either takes the panel.
    const properties = this.sections.get("properties")!,
      source = this.sections.get("source")!;
    properties.classList.toggle("closed", !this.open.properties);
    source.classList.toggle("closed", !this.open.source);
    properties.style.flex = this.open.properties && this.open.source ? `0 0 ${this.split}px` : "";
    this.sidePanel.classList.toggle("split", this.open.properties && this.open.source);
    for (const [which, made] of this.sections)
      made.querySelector(".fold")!.setAttribute("aria-expanded", String(this.open[which]));
  }

  /** Shows a tab of the left panel, or closes the panel. */
  private show(which: "shapes" | "outline" | "") {
    this.left = which;
    if (!this.narrow) this.shell.remember("left", which || "none");
    this.arrange();
  }

  private toggleSide() {
    this.side = !this.side;
    if (!this.tiny) this.shell.remember("side", this.side ? "open" : "closed");
    this.arrange();
  }

  private shows(panel: PanelName): boolean {
    return panel === "shapes" || panel === "outline"
      ? this.left === panel
      : this.side && this.open[panel];
  }

  /** Shows or hides a part of the window: a tab of the left panel, or a section of the right one. */
  private toggle(panel: PanelName) {
    if (panel === "shapes" || panel === "outline")
      return this.show(this.left === panel ? "" : panel);
    if (!this.side) {
      this.open[panel] = true;
      this.toggleSide();
    } else this.open[panel] = !this.open[panel];
    if (panel === "properties")
      this.shell.remember(
        this.text ? "properties-text" : "properties",
        this.open[panel] ? "open" : "closed",
      );
    else this.shell.remember("source-open", this.open[panel] ? "open" : "closed");
    this.arrange();
  }

  private toggleSnap() {
    const { editor } = this;
    editor.snapping = !editor.snapping;
    this.shell.remember("snap", editor.snapping ? "on" : "off");
    this.update();
  }

  private toggleGrid() {
    const { view } = this.editor;
    view.grid = !view.grid;
    this.shell.remember("grid", view.grid ? "on" : "off");
    view.invalidate();
  }

  private setWrap(on: boolean) {
    this.source.setWrap(on);
    this.wrap.setAttribute("aria-pressed", String(on));
    this.shell.remember("wrap", on ? "on" : "off");
  }

  /** The title field is as wide as its text: the box around it takes the text's width. */
  private sizeTitle() {
    this.titleBox.dataset.value = this.title.value || this.title.placeholder;
  }

  // Commands of the window.

  /** Opens the chooser of diagram types, for a new diagram. */
  chooser() {
    const { editor, shell } = this;
    chooser({
      current: editor.type,
      unsaved: shell.unsaved,
      sketch: (source) => editor.doc.sketch(source, editor.colors),
      create: (source) => shell.replace(source, true),
    });
  }

  /** Lays the whole diagram out automatically, and says so with a way back. */
  private async autoLayout() {
    const { editor } = this,
      before = editor.doc.source;
    await editor.autoLayout();
    if (editor.doc.source !== before)
      this.toast("Positions cleared. The layout is automatic.", {
        name: "Undo",
        run: () => editor.doc.undo(),
      });
  }

  /** Adds a snippet to the source where its cursor is, with the source on show. */
  private insert(text: string) {
    if (!this.shows("source")) this.toggle("source");
    this.source.insert(text);
  }

  /** Shows where the problem is: the line of an error in the source, or the elements that lie on each other. */
  private showProblem() {
    const { editor } = this,
      { doc } = editor;
    if (doc.problem) {
      if (!this.shows("source")) this.toggle("source");
      this.source.focusLine(doc.problem.line || 1);
      return;
    }
    const ids = [...new Set(doc.picture?.overlaps.flat() ?? [])].filter((id) =>
      doc.picture!.diagram.nodes.has(id),
    );
    if (!ids.length) return;
    editor.select(ids.map((id) => ({ type: "element", id })));
    editor.fitSelection();
  }

  /** Says something for a few seconds, with a step to take when one is offered. */
  toast(message: string, action?: ToastAction) {
    const note = h(
      "div",
      { class: "toast" },
      h("span", {}, message),
      action &&
        h(
          "button",
          {
            type: "button",
            onClick: () => {
              note.remove();
              action.run();
            },
          },
          action.name,
        ),
    );
    this.toasts.replaceChildren(note);
    window.setTimeout(() => note.remove(), action ? 8000 : 5000);
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
    // As wide as its longest line and as high as its lines, around the middle of the box: nothing wraps.
    const ruler = document.createElement("canvas").getContext("2d")!;
    const fit = () => {
      ruler.font = `${options.weight} ${size}px system-ui, sans-serif`;
      const longest = Math.max(
          ...field.value.split("\n").map((line) => ruler.measureText(line).width),
        ),
        width = Math.max(on.width + 24, longest + 28, 100),
        height = Math.max(on.height, lines() * size * 1.3 + 8);
      Object.assign(field.style, {
        left: `${on.x + on.width / 2 - width / 2}px`,
        top: `${on.y + on.height / 2 - height / 2}px`,
        width: `${width}px`,
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
    field.addEventListener("pointerdown", (event) => event.stopPropagation());
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
    const { editor, shell } = this,
      { doc } = editor,
      info = typeInfo(editor.type),
      text = info.mode === "text";
    if (text !== this.text) {
      // Text needs room to be read, and has no properties to show: the right panel starts wider, the source alone.
      const first = this.text === undefined;
      this.text = text;
      this.widths.right =
        Number(shell.recall(text ? "right-width-text" : "right-width")) ||
        (text ? RIGHT.text : RIGHT.start);
      this.open.properties =
        (shell.recall(text ? "properties-text" : "properties") ?? (text ? "closed" : "open")) ===
        "open";
      this.arrange();
      if (!first) void editor.fitSoon();
    }
    for (const [tool, control] of this.tools) {
      control.setAttribute("aria-pressed", String(tool === editor.tool));
      setOff(control, text && tool !== "pan" && `${info.plural} are edited as text`);
    }
    setOff(this.undo, !doc.canUndo);
    setOff(this.redo, !doc.canRedo);
    this.arrangeTitle.hidden = !editor.editable;
    if (document.activeElement !== this.title) this.title.value = doc.picture?.title ?? "";
    this.sizeTitle();
    this.chip.replaceChildren(icon(info.icon), h("span", {}, info.name), icon("chevron"));
    Object.assign(this.chip.dataset, { tip: `${info.about}. Click for a new diagram.` });
    this.dot.hidden = !shell.unsaved;

    if (!this.typing && this.source.setText(doc.source)) this.lines = "replaced";
    this.source.setProblem(doc.problem);
    // The lines of what is selected on the canvas are marked in the source.
    const lines = doc.problem
      ? []
      : editor.selectedElements.flatMap((id) => doc.picture?.diagram.nodes.get(id)?.line ?? []);
    if (lines.join() !== this.lines) {
      this.lines = lines.join();
      this.source.setSelectedLines(lines);
    }
    this.problem.replaceChildren(...prose(doc.problem?.message ?? ""));
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
    this.problems.textContent = doc.problem ? "1 problem" : "";
    this.problems.hidden = !doc.problem;

    // An error leaves the last good picture on show, dimmed, with a banner that says so.
    this.stage.classList.toggle("stale", !!doc.problem);
    this.banner.hidden = !doc.problem;
    this.banner.textContent = doc.problem
      ? `The source has an error${doc.problem.line ? ` on line ${doc.problem.line}` : ""}. Showing the last valid diagram.`
      : "";
    this.preview.hidden = !text;
    const none = !doc.problem && !!doc.picture && !doc.picture.scene.shapes.length;
    if (this.empty.hidden !== !none || !this.empty.childElementCount)
      this.empty.replaceChildren(
        h("strong", {}, "An empty diagram"),
        ...(text
          ? [h("span", {}, "Type in the source, or add a snippet from the left.")]
          : [
              h("span", {}, "Drag a shape here from the left, or double-click for an agent."),
              h(
                "span",
                { class: "note" },
                "Positions are written into the source as ",
                h("code", {}, "@x,y"),
                "; without them the layout is automatic.",
              ),
            ]),
      );
    this.empty.hidden = !none;

    this.palette.update();
    this.outline.update();
    this.inspector.update();
    this.status.update();
    this.minimap.draw();
  }
}
