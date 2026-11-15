/**
 * The editor's window around the canvas: the bar with the menus and the document's title, the tool
 * rail, the left panel (shapes and outline), the right panel (properties and source), the status
 * bar, and what lies over the canvas (notices, the banner of an error, the minimap).
 */

import type { Box } from "../src/scene.ts";
import { chooser, commandDialog, dialogOpen, helpDialog, syntaxDialog } from "./dialogs.ts";
import { h, icon, iconButton, isOff, prose, setOff, tipped } from "./dom.ts";
import type { Editor, Tool, TreeItem } from "./editor.ts";
import type { IconName } from "./icons.ts";
import { Inspector } from "./inspector.ts";
import { closeMenu, menuButton, menuOpen, popup } from "./menu.ts";
import { type Bench, Menus, type PanelName, type Shell } from "./menus.ts";
import { Minimap } from "./minimap.ts";
import { Outline, within } from "./outline.ts";
import { Palette } from "./palette.ts";
import { declarationLines } from "./completion-uml.ts";
import type { Problem } from "./document.ts";
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

/**
 * The widths the panels start with and may be dragged to, and the widths of the window below which
 * the left one starts narrower (`SMALL`) and below which they lie over the canvas.
 */
const LEFT = { start: 240, small: 216, least: 200, most: 360 },
  RIGHT = { start: 320, text: 480, least: 280, most: 560 },
  SMALL = 1200,
  NARROW = 1000,
  TINY = 860;

/** The share of the right panel the properties keep while the source is expanded. */
const EXPANDED = "30%";

/** A step to take back or go on with, offered in a notice. */
export interface ToastAction {
  name: string;
  run(): void;
}

/** How long the typing rests before an error it left is said. */
const REST = 1000;

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
  /** The titles of the bar's menus, by name. */
  private readonly titles = new Map<string, HTMLButtonElement>();
  /** What had the focus before the keyboard went to the menu bar: it gets the focus back. */
  private origin: HTMLElement | undefined;
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
  private readonly expand: HTMLButtonElement;
  private readonly problem = h("button", { class: "problem", type: "button" });
  private readonly warning = h("div", { class: "problem warning", role: "status" });
  private readonly problems = h("span", { class: "count" });

  // Over the canvas.
  private readonly toasts = h("div", { class: "toasts", role: "status" });
  private readonly banner = h("button", { class: "banner", type: "button" });
  /** When the source was typed in last, and the timer that shows an error once the typing rests. */
  private typed = 0;
  private resting: number | undefined;
  /** The problem on show: the document's, once it is no longer one of typing under way. */
  private said: Problem | undefined;
  private declaredOf: string | undefined;
  private declaredLines = new Map<string, number>();
  private readonly preview = h("div", { class: "preview-label" }, "Preview");
  private readonly empty = h("div", { class: "empty" });
  private readonly away = h(
    "button",
    { class: "away", type: "button", onClick: () => this.editor.fit() },
    icon("fit"),
    h("span", {}, "Back to the diagram"),
  );
  private welcome: HTMLElement | undefined;
  /** Where the pointer is on the canvas, while it is there. */
  private pointer: { x: number; y: number } | undefined;

  // How the window is laid out.
  /** The tab of the left panel on show; none when the panel is closed. */
  private left: "shapes" | "outline" | "" = "shapes";
  /** Whether the right panel shows. */
  private side = true;
  private readonly open = { properties: true, source: true };
  /** The widths the panels were dragged to; 0 for a panel that keeps the width it starts with. */
  private readonly widths = { left: 0, right: 0 };
  /** The height of the Properties section while Source shows below it; 0 while the two share the panel evenly. */
  private split = 0;
  /** Whether the source takes most of the right panel. */
  private wide = false;
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
      help: () => helpDialog(editor.type),
      syntax: () => syntaxDialog(editor.type),
      commands: () => commandDialog(this.menus.commands()),
      autoLayout: () => void this.autoLayout(),
      shows: (panel) => this.shows(panel),
      toggle: (panel) => this.toggle(panel),
      toggleSnap: () => this.toggleSnap(),
      toggleGrid: () => this.toggleGrid(),
      get minimap() {
        return minimap.enabled;
      },
      toggleMinimap: () => {
        minimap.enabled = !minimap.enabled;
        shell.remember("minimap", minimap.enabled ? "on" : "off");
        minimap.draw();
      },
    };
    const minimap = new Minimap(editor);
    minimap.enabled = shell.recall("minimap") !== "off";
    this.menus = new Menus(editor, shell, bench);
    this.status = new StatusBar(editor, {
      layout: () => this.menus.layoutMode(),
      zoom: () => this.menus.zoom(),
      showProblem: () => this.showProblem(),
      toggleSnap: () => this.toggleSnap(),
    });
    this.palette = new Palette(editor, (text) => this.insert(text));
    this.outline = new Outline(editor, (at) => popup(this.menus.context({ x: 0, y: 0 }), at));
    this.inspector = new Inspector(editor);
    this.minimap = minimap;

    // The bar: the menus, the document, and the few commands worth a button.
    this.undo = iconButton("undo", { tip: "Undo", key: "Ctrl+Z" }, () => editor.doc.undo());
    this.redo = iconButton("redo", { tip: "Redo", key: "Ctrl+Shift+Z" }, () => editor.doc.redo());
    const names = this.menus.bar().map(({ name }) => name),
      titles = names.map((name) => h("button", { class: "menu-title", type: "button" }, name)),
      shown = () => titles.filter((title) => !isOff(title));
    /** Set while one menu of the bar takes the place of another: the bar is not left then. */
    let switching = false;
    const opened = titles.map((title, index) =>
      menuButton(title, () => this.menus.bar()[index].items(), {
        // The arrow keys go from menu to menu along the bar.
        step: (by) => {
          const list = shown(),
            next = list[(list.indexOf(title) + by + list.length) % list.length];
          switchTo(titles.indexOf(next), true);
        },
        closed: () => {
          if (!switching) this.leaveBar();
        },
      }),
    );
    const switchTo = (index: number, first = false) => {
      switching = true;
      opened[index].open(first);
      switching = false;
    };
    titles.forEach((title, index) => {
      this.titles.set(names[index], title);
      // With one menu open, the pointer opens the others as it passes.
      title.addEventListener("pointerenter", () => {
        if (opened.some((menu, other) => other !== index && menu.isOpen)) switchTo(index);
      });
      // With the focus on the bar, the arrow keys go along it and down into a menu; Escape leaves it.
      title.addEventListener("keydown", (event) => {
        const list = shown(),
          at = list.indexOf(title),
          by = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
        if (by) list[(at + by + list.length) % list.length]?.focus();
        else if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")
          opened[index].open(true);
        else if (event.key === "Escape") this.leaveBar();
        else return;
        event.preventDefault();
        event.stopPropagation();
      });
    });
    this.title.addEventListener("input", () => this.sizeTitle());
    this.title.addEventListener("change", () => this.commitTitle());
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
        iconButton("help", { tip: "Keyboard and mouse", key: "?" }, () => helpDialog(editor.type)),
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
        () => this.leftWidth,
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
        // An error that comes with the typing is said once the typing rests.
        this.typed = performance.now();
        window.clearTimeout(this.resting);
        this.resting = window.setTimeout(() => this.update(), REST + 20);
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
        const { picture } = editor.doc;
        if (!picture || editor.doc.problem || picture.source !== editor.doc.source) return;
        // The line declares an element, or says a connection: that is what is selected.
        const declared = this.declared(),
          node = [...picture.diagram.nodes.values()].find(
            (item) => (declared.get(item.id) ?? item.line) === line && !/#\d*$|#row$/.test(item.id),
          ),
          edge = node ? undefined : picture.diagram.edges.find((item) => item.line === line);
        if (node) {
          this.lines = String(line);
          editor.select([{ type: "element", id: node.id }]);
          editor.reveal(node.id);
        } else if (edge) {
          this.lines = String(line);
          editor.select([{ type: "wire", id: edge.id.replace(/#\d+$/, "") }]);
        }
      },
    });
    this.wrap = iconButton(
      "wrap",
      { tip: "Wrap long lines" },
      () => this.setWrap(this.wrap.getAttribute("aria-pressed") !== "true"),
      "button small",
    );
    this.expand = iconButton(
      "expand",
      { tip: "Give the source most of the panel" },
      () => {
        this.wide = !this.wide;
        shell.remember("source-wide", this.wide ? "on" : "off");
        // The source shows, whatever was folded, when it is asked to take the room.
        if (this.wide && !this.open.source) this.toggle("source");
        else this.arrange();
      },
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
        this.wide = false;
        shell.remember("split", String(this.split));
        shell.remember("source-wide", "off");
        this.arrange();
      },
      () => {
        // A double click shares the panel evenly again.
        this.split = 0;
        this.wide = false;
        shell.remember("split", "");
        shell.remember("source-wide", "off");
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
        () => this.rightWidth,
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
        [this.problems, this.wrap, this.expand],
        this.problem,
        this.warning,
        sourceBox,
      ),
    );

    // Over the canvas.
    this.banner.addEventListener("click", () => this.showProblem());
    stage.append(
      this.empty,
      this.preview,
      this.banner,
      this.away,
      this.minimap.element,
      this.toasts,
    );
    // A press on the canvas puts away a panel that lies over it.
    stage.addEventListener("pointerdown", () => {
      if (this.narrow && this.left) this.show("");
      if (this.tiny && this.side) this.toggleSide();
    });
    // The stage never scrolls, whatever in it takes the focus near its edge, and nothing on it is
    // dragged as a picture or a selected text is: a drag on the canvas is the editor's.
    stage.addEventListener("scroll", () => stage.scrollTo(0, 0));
    stage.addEventListener("dragstart", (event) => event.preventDefault());
    const { canvas } = editor.view;
    canvas.addEventListener("pointermove", (event) => {
      this.pointer = editor.view.pointOf(event);
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointer = undefined;
    });
    root.append(header, rail, this.leftPanel, stage, this.sidePanel, this.status.element);

    // What was chosen on an earlier visit.
    const number = (key: string, start: number) => Number(shell.recall(key)) || start;
    this.left = { shapes: "shapes", outline: "outline", none: "" }[
      shell.recall("left") ?? "shapes"
    ] as typeof this.left;
    this.side = shell.recall("side") !== "closed";
    this.open.source = shell.recall("source-open") !== "closed";
    this.widths.left = number("left-width", 0);
    this.split = number("split", 0);
    this.wide = shell.recall("source-wide") === "on";
    editor.snapping = shell.recall("snap") !== "off";
    editor.view.grid = shell.recall("grid") !== "off";
    // Wrapped unless switched off: a line cut at the pane's edge hides what it says.
    this.setWrap(shell.recall("wrap") !== "off");
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
    editor.onHelp = () => helpDialog(editor.type);
    editor.onPointer = (point) => this.status.showPointer(point);
    editor.editText = (box, text, options, done) => this.editText(box, text, options, done);
    editor.view.onView = () => {
      this.status.showZoom();
      // The diagram moved under a pointer that stands still: its place in the diagram is another.
      if (this.pointer) this.status.showPointer(editor.view.toScene(this.pointer));
      this.minimap.draw();
      this.showAway();
    };
    this.shortcuts();
    if (shell.recall("welcomed") !== "yes") this.greet();
    this.arrange();
  }

  // The keyboard.

  /**
   * The keys of the window: saving, opening, a new diagram, the list of commands, the menu bar and
   * the zoom. They are handled here, before anything else sees them, because what they do depends on
   * what is open: under a dialog they do nothing, and a menu closes before they act. The browser
   * never gets them, so it shows no dialog of its own for Ctrl+S or Ctrl+O.
   */
  private shortcuts() {
    const { editor, shell } = this;
    /** Whether Alt went down and nothing else since: its release then goes to the menu bar. */
    let alone = false;
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") this.dismissWelcome();
        alone = event.key === "Alt" && !event.ctrlKey && !event.metaKey && !event.shiftKey;
        // Alt is kept from the browser's own menu.
        if (event.key === "Alt") return event.preventDefault();
        const command = event.ctrlKey || event.metaKey,
          key = event.key.length === 1 ? event.key.toLowerCase() : event.key,
          target = event.target as HTMLElement | null,
          typing =
            !!target &&
            (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
        let run: (() => void) | undefined,
          /** A key of the canvas: it is the dialog's, the menu's or the field's while one has the focus. */
          canvas = false;
        if (command && !event.altKey && key === "s")
          run = () => (event.shiftKey ? shell.saveFileAs() : shell.saveFile());
        else if (command && !event.altKey && !event.shiftKey && key === "o")
          run = () => shell.openFile();
        else if (command && event.altKey && (key === "n" || event.code === "KeyN"))
          run = () => this.chooser();
        else if (command && !event.altKey && !event.shiftKey && key === "k")
          run = () => commandDialog(this.menus.commands());
        else if (key === "F10" && !command && !event.altKey && !event.shiftKey)
          run = () => this.focusBar();
        else if (!event.altKey && (key === "+" || key === "=" || key === "-")) {
          canvas = true;
          run = () => editor.view.zoomStep(key === "-" ? -1 : 1);
        }
        if (!run) return;
        if (canvas && (typing || dialogOpen() || menuOpen())) return;
        event.preventDefault();
        event.stopPropagation();
        // The list of commands closes by its own key; no other key acts under a dialog.
        if (dialogOpen() && !(key === "k" && document.querySelector("dialog.commands"))) return;
        closeMenu();
        run();
      },
      true,
    );
    window.addEventListener(
      "keyup",
      (event) => {
        if (event.key !== "Alt" || !alone) return;
        alone = false;
        event.preventDefault();
        if (!dialogOpen()) this.focusBar();
      },
      true,
    );
    window.addEventListener("pointerdown", () => (alone = false), true);
    window.addEventListener("blur", () => (alone = false));
  }

  /** Puts the focus on the menu bar, or back where it was when the bar has it. */
  private focusBar() {
    const titles = [...this.titles.values()],
      active = document.activeElement as HTMLElement | null;
    if (menuOpen() || (active && titles.includes(active as HTMLButtonElement))) {
      closeMenu();
      return this.leaveBar();
    }
    this.origin = active ?? undefined;
    titles.find((title) => !isOff(title))?.focus();
  }

  /** Gives the focus back to what had it before the keyboard went to the menu bar. */
  private leaveBar() {
    const { origin } = this,
      active = document.activeElement as HTMLElement | null;
    this.origin = undefined;
    if (!origin) return;
    // Only from the bar: a command that opened a dialog or a field keeps the focus it took.
    if (active && active !== document.body && ![...this.titles.values()].includes(active as never))
      return;
    (origin.isConnected && origin !== document.body ? origin : this.editor.view.canvas).focus({
      preventScroll: true,
    });
  }

  /** Takes what is being typed into the document: the title in its field, a name on the canvas, the source. */
  commit() {
    const active = document.activeElement as HTMLElement | null;
    if (active === this.title) this.commitTitle();
    else if (active?.classList.contains("label-edit")) active.blur();
    if (this.typing !== undefined) {
      window.clearTimeout(this.typing);
      this.typing = undefined;
      void this.editor.doc.apply(this.source.text);
    }
  }

  private commitTitle() {
    const { editor } = this;
    if (this.title.value.trim() !== (editor.doc.picture?.title ?? ""))
      editor.setTitle(this.title.value);
  }

  // What lies over the canvas.

  /** Greets a first visit: what the sample is, what to try, and where a diagram of one's own starts. */
  private greet() {
    this.welcome = h(
      "aside",
      { class: "welcome", "aria-label": "Welcome" },
      h(
        "header",
        {},
        h("strong", {}, "Welcome to the TAM Editor"),
        iconButton("close", { tip: "Close" }, () => this.dismissWelcome(), "button small"),
      ),
      h(
        "p",
        {},
        "This is a sample to try things on: drag an element to move it, drag a dot beside it to connect, double-click to rename. Shapes on the left add more.",
      ),
      h(
        "p",
        {},
        "Your own diagram starts with ",
        h("b", {}, "File ▸ New"),
        " (",
        h("kbd", {}, "Ctrl+Alt+N"),
        "): a block diagram or one of six UML types.",
      ),
      h(
        "footer",
        {},
        h(
          "button",
          {
            class: "button primary",
            type: "button",
            onClick: () => {
              this.dismissWelcome();
              this.chooser();
            },
          },
          "New diagram…",
        ),
        h(
          "button",
          { class: "button outlined", type: "button", onClick: () => this.dismissWelcome() },
          "Got it",
        ),
      ),
    );
    this.stage.append(this.welcome);
  }

  /** Puts the greeting away for good. */
  private dismissWelcome() {
    if (!this.welcome) return;
    this.welcome.remove();
    this.welcome = undefined;
    this.shell.remember("welcomed", "yes");
  }

  /** Offers the way back while the view shows nothing of the diagram. */
  private showAway() {
    const { view, doc } = this.editor,
      scene = doc.picture?.scene,
      { width, height } = view.size;
    if (!scene?.shapes.length || !width) return void (this.away.hidden = true);
    const on = view.boxOnScreen(scene.bounds);
    this.away.hidden = !(
      on.x > width ||
      on.y > height ||
      on.x + on.width < 0 ||
      on.y + on.height < 0
    );
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

  /** The width of the left panel: the one it was dragged to, or the one it starts with in a window this wide. */
  private get leftWidth() {
    return this.widths.left || (window.innerWidth < SMALL ? LEFT.small : LEFT.start);
  }

  /** The width of the right panel: the one it was dragged to, or the one it starts with. Text needs room to be read. */
  private get rightWidth() {
    return this.widths.right || (this.text ? RIGHT.text : RIGHT.start);
  }

  /** Lays the window out as its state says: which panels show, how wide, and what the rail marks. */
  private arrange() {
    const { root } = this,
      left = !!this.left,
      wide = this.leftWidth,
      // The canvas keeps a part of the window, whatever the panels were dragged to.
      room = Math.max(
        RIGHT.least,
        window.innerWidth - 44 - (left && !this.narrow ? wide : 0) - 240,
      ),
      right = Math.min(this.rightWidth, this.tiny ? window.innerWidth - 44 : room);
    root.classList.toggle("left-over", this.narrow);
    root.classList.toggle("side-over", this.tiny);
    root.style.setProperty("--left", left && !this.narrow ? `${wide}px` : "0px");
    root.style.setProperty("--right", this.side && !this.tiny ? `${right}px` : "0px");
    this.leftPanel.style.width = `${wide}px`;
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
    properties.style.flex =
      this.open.properties && this.open.source
        ? `0 0 ${this.wide ? EXPANDED : this.split ? `${this.split}px` : "50%"}`
        : "";
    this.expand.setAttribute("aria-pressed", String(this.wide));
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

  /** The title field is as wide as its text: the box around it takes the text's width. A title too long for it is said whole by a tooltip. */
  private sizeTitle() {
    this.titleBox.dataset.value = this.title.value || this.title.placeholder;
    if (this.title.scrollWidth > this.title.clientWidth + 1)
      this.titleBox.dataset.tip = this.title.value;
    else delete this.titleBox.dataset.tip;
  }

  // Commands of the window.

  /** Opens the chooser of diagram types, for a new diagram. */
  chooser() {
    const { editor, shell } = this;
    chooser({
      current: editor.type,
      unsaved: shell.unsaved,
      recents: shell.recents(),
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

  /**
   * Says something for a few seconds, with a step to take when one is offered. It stays while the
   * pointer is on it, and goes at once by its close button.
   */
  toast(message: string, action?: ToastAction) {
    let timer: number | undefined;
    const wait = () => {
      timer = window.setTimeout(() => note.remove(), action ? 8000 : 5000);
    };
    const note = h(
      "div",
      {
        class: "toast",
        onPointerenter: () => window.clearTimeout(timer),
        onPointerleave: wait,
      },
      h("span", {}, message),
      action &&
        h(
          "button",
          {
            class: "toast-action",
            type: "button",
            onClick: () => {
              note.remove();
              action.run();
            },
          },
          action.name,
        ),
      iconButton("close", { tip: "Close", side: "top" }, () => note.remove(), "toast-close"),
    );
    this.toasts.replaceChildren(note);
    wait();
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
        // Inside the stage, however near its edge the box stands.
        room = { width: this.stage.clientWidth - 8, height: this.stage.clientHeight - 8 },
        width = Math.min(Math.max(on.width + 24, longest + 28, 100), room.width),
        height = Math.min(Math.max(on.height, lines() * size * 1.3 + 8), room.height),
        within = (at: number, length: number, most: number) =>
          Math.max(4, Math.min(at, most + 4 - length));
      Object.assign(field.style, {
        left: `${within(on.x + on.width / 2 - width / 2, width, room.width)}px`,
        top: `${within(on.y + on.height / 2 - height / 2, height, room.height)}px`,
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
    field.focus({ preventScroll: true });
    field.select();
    this.stage.scrollTo(0, 0);
  }

  /** The line that declares each part of a Mermaid source: the one to mark and to select by. */
  private declared(): Map<string, number> {
    const { editor } = this;
    if (editor.type === "tam" || editor.doc.problem) return new Map();
    if (this.declaredOf !== editor.doc.source) {
      this.declaredOf = editor.doc.source;
      try {
        this.declaredLines = declarationLines(editor.type, editor.doc.source);
      } catch {
        this.declaredLines = new Map();
      }
    }
    return this.declaredLines;
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
      this.widths.right = Number(shell.recall(text ? "right-width-text" : "right-width")) || 0;
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
    for (const menu of this.menus.bar()) {
      const title = this.titles.get(menu.name)!;
      setOff(title, menu.off);
      title.dataset.side = "bottom";
    }
    if (document.activeElement !== this.title) this.title.value = doc.picture?.title ?? "";
    this.sizeTitle();
    this.chip.replaceChildren(icon(info.icon), h("span", {}, info.name), icon("chevron"));
    Object.assign(this.chip.dataset, { tip: `${info.about}. Click for a new diagram.` });
    this.dot.hidden = !shell.unsaved;

    if (!this.typing && this.source.setText(doc.source)) this.lines = "replaced";
    // An error made by typing shows when the typing has rested, or the cursor has left its line: a
    // statement half typed is no error yet. One that goes, goes at once.
    const waiting =
      !!doc.problem &&
      this.source.focused &&
      performance.now() - this.typed < REST &&
      this.said?.message !== doc.problem.message;
    this.said = waiting ? this.said : doc.problem;
    const problem = this.said;
    this.source.setProblem(problem);
    // The lines of what is selected on the canvas are marked in the source: where an element is
    // declared, and where a connection is said.
    const declared = this.declared(),
      lines = doc.problem
        ? []
        : [
            ...editor.selectedElements.flatMap(
              (id) => declared.get(id) ?? doc.picture?.diagram.nodes.get(id)?.line ?? [],
            ),
            ...editor.selectedWires.flatMap(
              (id) => doc.picture?.diagram.edges.find((edge) => edge.id === id)?.line ?? [],
            ),
          ];
    if (lines.join() !== this.lines) {
      this.lines = lines.join();
      this.source.setSelectedLines(lines);
    }
    this.problem.replaceChildren(...prose(problem?.message ?? ""));
    this.problem.hidden = !problem;
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
    this.stage.classList.toggle("stale", !!problem);
    this.banner.hidden = !problem;
    this.banner.textContent = problem
      ? `The source has an error${problem.line ? ` on line ${problem.line}` : ""}.${doc.picture ? " Showing the last valid diagram." : ""}`
      : "";
    this.preview.hidden = !text;
    const none = !doc.problem && !!doc.picture && !doc.picture.scene.shapes.length;
    if (this.empty.hidden !== !none || !this.empty.childElementCount)
      this.empty.replaceChildren(
        h("strong", {}, "An empty diagram"),
        ...(text
          ? [h("span", {}, "Type in the source, or add a snippet from the left.")]
          : editor.structural
            ? [
                h(
                  "span",
                  {},
                  `Click a shape on the left, or double-click here, to add the first ${
                    editor.structure?.pieces[0]?.name.toLowerCase() ?? "part"
                  }.`,
                ),
              ]
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
    this.showAway();
  }
}
