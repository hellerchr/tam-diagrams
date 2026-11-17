/**
 * The editor's window around the canvas: the bar with the menus and the document's title, the tool
 * rail, the left panel (shapes and outline), the right panel (properties and source), the status
 * bar, and what lies over the canvas (notices, the banner of an error, the minimap).
 */

import type { Box } from "../src/scene.ts";
import {
  chooser,
  commandDialog,
  dialogOpen,
  focusDialog,
  helpDialog,
  syntaxDialog,
} from "./dialogs.ts";
import { h, icon, iconButton, isOff, prose, setOff, tipped } from "./dom.ts";
import type { Editor, Tool, TreeItem } from "./editor.ts";
import type { IconName } from "./icons.ts";
import { Inspector } from "./inspector.ts";
import { closeMenu, menuButton, menuOpen, popup } from "./menu.ts";
import { type Bench, Menus, type PanelName, type Shell } from "./menus.ts";
import { Minimap } from "./minimap.ts";
import { Outline } from "./outline.ts";
import { Palette } from "./palette.ts";
import { GuideSheet } from "./reference-dialog.ts";
import type { Known } from "./completion.ts";
import { declarationLines } from "./completion-uml.ts";
import type { Problem } from "./document.ts";
import { SourcePane } from "./source.ts";
import { StatusBar } from "./statusbar.ts";
import { installTooltips } from "./tooltip.ts";
import { sameType, typeInfo } from "./types.ts";

/** The pointer tools of the rail. */
const POINTERS: { tool: Tool; icon: IconName; name: string; key: string }[] = [
  { tool: "select", icon: "select", name: "Select, move and resize", key: "V" },
  { tool: "pan", icon: "pan", name: "Pan: move the view", key: "H" },
  { tool: "connect", icon: "connect", name: "Connect: drag from one element to another", key: "C" },
];

/**
 * The widths the panels start with and may be dragged to, and the widths of the window below which
 * the left one starts closed and the right one narrow (`SMALL`), and below which they lie over
 * the canvas.
 */
const LEFT = { start: 240, least: 200, most: 360 },
  RIGHT = { start: 320, small: 280, text: 480, least: 280, most: 560 },
  SMALL = 1200,
  NARROW = 1000,
  TINY = 860;

/** The least height either of Properties and Source keeps while both show. */
const SECTION = 160;

/** The share of the right panel the properties keep while the source is expanded. */
const EXPANDED = "30%";

/** A part of the diagram that is selected: an element or a connection. */
type Part = Editor["selection"][number];

/** A step to take back or go on with, offered in a notice. */
export interface ToastAction {
  name: string;
  run(): void;
}

/** How long the typing rests before an error it left is said. */
const REST = 1000;

/** How long the typing rests before the picture follows a statement that is still being typed. */
const PAUSE = 600;

/** The most sources whose selection is remembered, to select again after a step of the history. */
const REMEMBERED = 300;

/** The keys that fold a group of the properties by its title. */
const FOLDING = new Set(["Enter", " "]);

/** The keys that go along the menu bar, and those that open the menu whose title has the focus. */
const ALONG: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 },
  OPENING = new Set(["ArrowDown", "Enter", " "]);

/**
 * A key of the window, pressed with one of the sets of modifiers in `with`: `C` for Ctrl or Cmd,
 * `A` for Alt and `S` for Shift, in that order.
 */
interface Binding {
  keys: string[];
  /** The place of the key on the keyboard, for a key that may type another letter. */
  code?: string;
  with: string[];
  /** A key of the canvas: it is the dialog's, the menu's or the field's while one has the focus. */
  canvas?: boolean;
  run(event: KeyboardEvent, key: string): void;
}

/** The modifiers held with a key, as a binding names them. */
function modifiers(event: KeyboardEvent): string {
  return (
    (event.ctrlKey || event.metaKey ? "C" : "") +
    (event.altKey ? "A" : "") +
    (event.shiftKey ? "S" : "")
  );
}

/** Whether a key pressed with the modifiers `held` is the binding's. */
function bound(binding: Binding, event: KeyboardEvent, key: string, held: string): boolean {
  return (binding.keys.includes(key) || binding.code === event.code) && binding.with.includes(held);
}

/** A key of the canvas is the dialog's, the menu's or the field's while one has the focus. */
function keptFromCanvas(binding: Binding, event: KeyboardEvent): boolean {
  return !!binding.canvas && (typing(event.target) || dialogOpen() || menuOpen());
}

/** The list of commands closes by its own key; no other key acts under a dialog. */
function actsUnderDialog(key: string): boolean {
  return !dialogOpen() || (key === "k" && !!document.querySelector("dialog.commands"));
}

/** Whether the key goes to a field that takes typing. */
function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    !!element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName))
  );
}

/** Under a dialog every key is the dialog's, wherever the focus went: true when it was kept for it. */
function keptByDialog(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!dialogOpen() || target?.closest?.("dialog")) return false;
  focusDialog();
  event.stopPropagation();
  if (event.key !== "Tab" && event.key !== "Escape") event.preventDefault();
  return true;
}

export class Panels {
  private readonly root: HTMLElement;
  private readonly editor: Editor;
  private readonly shell: Shell;
  /** The button between light and dark, showing the mode a click switches to. */
  private readonly themeToggle: HTMLButtonElement;
  private readonly stage: HTMLElement;
  private readonly menus: Menus;
  private readonly status: StatusBar;
  private readonly palette: Palette;
  private readonly outline: Outline;
  private readonly inspector: Inspector;
  private readonly minimap: Minimap;
  private readonly source: SourcePane;
  /** The reference guide of a diagram type, beside the source. */
  private readonly guide: GuideSheet;
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
  /** The name of the diagram's file, once it has one. */
  private readonly fileName = h("span", { class: "file-name" });
  /** Opens a menu of the bar by the letter its name starts with; false when no menu starts with it. */
  private mnemonic: (letter: string) => boolean = () => false;
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
  private readonly expand: HTMLButtonElement;
  private readonly problem = h("button", { class: "problem", type: "button" });
  private readonly warning = h("button", { class: "problem warning", type: "button" });
  private readonly problems = h("span", { class: "count" });

  // Over the canvas.
  private readonly toasts = h("div", { class: "toasts", role: "status" });
  /** The notices that offer a step, each with the source it was made for: it goes when that is no longer on show. */
  private offers: { note: HTMLElement; source: string }[] = [];
  /** What was selected while each source was on show: a step of the history selects it again. */
  private readonly selections = new Map<string, Part[]>();
  /** Set by a step of the history until its source shows. */
  private stepping = false;
  /** The groups of the properties that are folded, by their titles. */
  private readonly folded: Set<string>;
  private readonly banner = h("button", { class: "banner", type: "button" });
  /** When the source was typed in last, and the timer that shows an error once the typing rests. */
  private typedAt = 0;
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
  /** The window leaves the canvas little room beside two panels: the left one starts closed, the right one narrow. */
  private small = false;
  /** Whether the diagram on show is edited as text; undefined before the first one shows. */
  private text: boolean | undefined;

  constructor(root: HTMLElement, stage: HTMLElement, editor: Editor, shell: Shell) {
    this.root = root;
    this.editor = editor;
    this.shell = shell;
    this.stage = stage;
    installTooltips();
    this.guide = this.makeGuide();
    this.minimap = new Minimap(editor);
    this.minimap.enabled = shell.recall("minimap") !== "off";
    this.menus = new Menus(editor, shell, this.bench());
    this.status = new StatusBar(editor, {
      layout: () => this.menus.layoutMode(),
      zoom: () => this.menus.zoom(),
      showProblem: () => this.showProblem(),
      toggleSnap: () => this.toggleSnap(),
    });
    this.palette = new Palette(editor, (text) => this.insert(text));
    this.outline = new Outline(editor, (at) => popup(this.menus.context({ x: 0, y: 0 }), at));
    this.inspector = new Inspector(editor);
    this.folded = new Set((shell.recall("groups-folded") ?? "").split("\n").filter(Boolean));
    this.foldByTitles();

    // The bar: the menus, the document, and the few commands worth a button.
    this.undo = iconButton("undo", { tip: "Undo", key: "Ctrl+Z" }, () => editor.doc.undo());
    this.redo = iconButton("redo", { tip: "Redo", key: "Ctrl+Shift+Z" }, () => editor.doc.redo());
    // One click between light and dark; View ▸ Theme also follows the system.
    this.themeToggle = iconButton("theme", { tip: "Dark mode" }, () => {
      shell.setTheme(this.dark ? "light" : "dark");
      this.showTheme();
    });
    this.showTheme();
    const header = this.makeBar(),
      rail = this.makeRail();
    this.leftPanel = this.makeLeftPanel();
    const sourceBox = h("div", { class: "source" });
    this.source = this.makeSource(sourceBox);
    this.expand = this.makeExpand();
    this.sidePanel = this.makeSidePanel(sourceBox);
    this.coverStage();
    root.append(
      header,
      rail,
      this.leftPanel,
      stage,
      this.guide.element,
      this.sidePanel,
      this.status.element,
    );
    this.recallLayout();
    this.hookEditor();
    this.shortcuts();
    if (shell.recall("welcomed") !== "yes") this.greet();
    this.arrange();
  }

  // The making of the window.

  /** The reference guide beside the source, whose examples replace the diagram on show. */
  private makeGuide() {
    const { editor, shell, root } = this;
    return new GuideSheet({
      type: () => editor.type,
      insert: (text) => this.insert(text),
      example: (source, at) => {
        // An empty diagram is replaced at once; one with unsaved changes after the shell asked.
        if (!editor.doc.source.trim()) shell.replace(source, true);
        else if (shell.unsaved) shell.replace(source);
        else
          popup(
            [{ name: "Replace the diagram on show", run: () => shell.replace(source, true) }],
            at,
            { above: true },
          );
      },
      notify: (message) => this.toast(message),
      shown: (open) => root.classList.toggle("guide-open", open),
    });
  }

  /** What the menus may ask of the window: its dialogs, its panels and its switches. */
  private bench(): Bench {
    const { editor, shell } = this,
      panels = this;
    return {
      chooser: () => this.chooser(),
      help: () => helpDialog(editor.type),
      syntax: () => syntaxDialog(editor.type),
      guide: (page) => (page ? this.guide.open(page) : this.guide.toggle()),
      commands: () => commandDialog(this.menus.commands()),
      autoLayout: () => void this.autoLayout(),
      shows: (panel) => this.shows(panel),
      toggle: (panel) => this.toggle(panel),
      toggleSnap: () => this.toggleSnap(),
      toggleGrid: () => this.toggleGrid(),
      get minimap() {
        return panels.minimap.enabled;
      },
      toggleMinimap: () => {
        const { minimap } = this;
        minimap.enabled = !minimap.enabled;
        shell.remember("minimap", minimap.enabled ? "on" : "off");
        minimap.draw();
      },
    };
  }

  /** A group of the properties folds by its title, with the pointer or with Enter and Space. */
  private foldByTitles() {
    const fold = (event: Event) => {
      const title = (event.target as Element | null)?.closest?.(".group > h3");
      if (!title) return false;
      const name = title.textContent ?? "";
      if (this.folded.has(name)) this.folded.delete(name);
      else this.folded.add(name);
      this.shell.remember("groups-folded", [...this.folded].join("\n"));
      this.foldGroups();
      return true;
    };
    this.inspector.element.addEventListener("click", fold);
    this.inspector.element.addEventListener("keydown", (event) => {
      if (!FOLDING.has(event.key) || !fold(event)) return;
      event.preventDefault();
      event.stopPropagation();
    });
  }

  /** The bar along the top: the menus, the document's title and type, and a few buttons. */
  private makeBar() {
    const { editor } = this;
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
    return h(
      "header",
      { class: "bar" },
      h(
        "div",
        { class: "bar-start" },
        h("span", { class: "logo", ...tipped({ tip: "TAM Editor" }) }, icon("logo")),
        h("nav", { class: "menubar", "aria-label": "Menus" }, ...this.makeMenuTitles()),
      ),
      h("div", { class: "bar-doc" }, this.titleBox, this.dot, this.fileName, this.chip),
      h(
        "div",
        { class: "bar-end" },
        this.undo,
        this.redo,
        exporting,
        this.themeToggle,
        iconButton("help", { tip: "Keyboard and mouse", key: "?" }, () => helpDialog(editor.type)),
      ),
    );
  }

  /**
   * The titles of the bar's menus. The first letter of a name opens its menu with Alt, and is
   * underlined while Alt is held; with one menu open, the pointer and the arrow keys go to the others.
   */
  private makeMenuTitles() {
    const names = this.menus.bar().map(({ name }) => name),
      titles = names.map((name) =>
        h(
          "button",
          { class: "menu-title", type: "button", "aria-keyshortcuts": `Alt+${name[0]}` },
          h("u", {}, name[0]),
          name.slice(1),
        ),
      ),
      shown = () => titles.filter((title) => !isOff(title)),
      /** The title `by` steps along the bar from `title`, past the titles that are off. */
      along = (title: HTMLButtonElement, by: number) => {
        const list = shown();
        return list[(list.indexOf(title) + by + list.length) % list.length];
      };
    /** Set while one menu of the bar takes the place of another: the bar is not left then. */
    let switching = false;
    const opened = titles.map((title, index) =>
      menuButton(title, () => this.menus.bar()[index].items(), {
        // The arrow keys go from menu to menu along the bar.
        step: (by) => switchTo(titles.indexOf(along(title, by)), true),
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
    this.mnemonic = (letter) => {
      const index = names.findIndex((name) => name[0].toLowerCase() === letter);
      if (index < 0 || isOff(titles[index])) return false;
      if (!menuOpen()) this.origin = (document.activeElement as HTMLElement | null) ?? undefined;
      if (!opened[index].isOpen) switchTo(index, true);
      return true;
    };
    titles.forEach((title, index) => {
      this.titles.set(names[index], title);
      // With one menu open, the pointer opens the others as it passes.
      title.addEventListener("pointerenter", () => {
        if (opened.some((menu, other) => other !== index && menu.isOpen)) switchTo(index);
      });
      title.addEventListener("keydown", (event) =>
        this.barKey(
          event,
          () => opened[index].open(true),
          () => along(title, ALONG[event.key]),
        ),
      );
    });
    return titles;
  }

  /**
   * With the focus on the bar, the arrow keys go along it to the title `next` gives and down into
   * the menu with `open`; Escape leaves it.
   */
  private barKey(
    event: KeyboardEvent,
    open: () => void,
    next: () => HTMLButtonElement | undefined,
  ) {
    if (ALONG[event.key]) next()?.focus();
    else if (OPENING.has(event.key)) open();
    else if (event.key === "Escape") this.leaveBar();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  /** The rail: the pointer tools, then what the panels show. */
  private makeRail() {
    const tool = (entry: (typeof POINTERS)[number]) => {
      const control = iconButton(
        entry.icon,
        { tip: entry.name, key: entry.key, side: "right" },
        () => this.editor.setTool(entry.tool),
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
    return h(
      "nav",
      { class: "rail", "aria-label": "Tools and panels" },
      ...POINTERS.map(tool),
      h("hr"),
      toggle("shapes", "shapes", "Shapes", () => this.toggle("shapes")),
      toggle("outline", "outline", "Outline", () => this.toggle("outline")),
      h("span", { class: "spacer" }),
      toggle("side", "panel", "Properties and source", () => this.toggleSide()),
    );
  }

  /** The left panel: two tabs that take its whole height. */
  private makeLeftPanel() {
    const tab = (which: "shapes" | "outline", name: string) => {
      const control = h(
        "button",
        { class: "tab", type: "button", role: "tab", onClick: () => this.show(which) },
        name,
      );
      this.tabs.set(which, control);
      return control;
    };
    return h(
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
          this.shell.remember("left-width", String(width));
        },
      ),
    );
  }

  /** The source pane, whose typing becomes the document and whose cursor selects on the canvas. */
  private makeSource(box: HTMLElement) {
    const { editor } = this;
    return new SourcePane(box, {
      changed: (text, whole) => this.typed(text, whole),
      // The elements with what holds them: a connection reaches no element its end holds.
      elements: () => {
        const flat = (items: TreeItem[], parent: string | null): Known[] =>
          items.flatMap((item) => [
            { id: item.id, kind: item.kind, label: item.label, parent },
            ...flat(item.children, item.id),
          ]);
        return flat(editor.tree, null).filter((item) => !item.id.includes("#"));
      },
      completes: () => editor.editable,
      type: () => editor.type,
      undo: () => editor.doc.undo(),
      redo: () => editor.doc.redo(),
      cursorAt: (line) => this.selectLine(line),
    });
  }

  /** Text was typed in the source: `whole` when it ends a statement. */
  private typed(text: string, whole: boolean) {
    // The picture follows a statement at once, and one that is still being typed once the typing rests.
    window.clearTimeout(this.typing);
    this.typing = window.setTimeout(
      () => {
        this.typing = undefined;
        void this.editor.doc.apply(text);
      },
      whole ? 0 : PAUSE,
    );
    // An error that comes with the typing is said once the typing rests.
    this.typedAt = performance.now();
    window.clearTimeout(this.resting);
    this.resting = window.setTimeout(() => this.update(), REST + 20);
  }

  /** The cursor rests on a line of the source: the element it declares, or the connection it says, is selected. */
  private selectLine(line: number) {
    const { editor } = this,
      { picture } = editor.doc;
    if (!picture || editor.doc.problem || picture.source !== editor.doc.source) return;
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
  }

  /** The button that gives the source most of the right panel. */
  private makeExpand() {
    return iconButton(
      "expand",
      { tip: "Give the source most of the panel" },
      () => {
        this.wide = !this.wide;
        this.shell.remember("source-wide", this.wide ? "on" : "off");
        // The source shows, whatever was folded, when it is asked to take the room.
        if (this.wide && !this.open.source) this.toggle("source");
        else this.arrange();
      },
      "button small",
    );
  }

  /** The right panel: properties above the source, each in a place of its own. */
  private makeSidePanel(sourceBox: HTMLElement) {
    // A strip says its problem in one line; a click shows it whole, and where the problem is.
    for (const strip of [this.problem, this.warning])
      strip.addEventListener("click", () => {
        strip.classList.toggle("whole");
        this.showProblem();
      });
    return h(
      "aside",
      { class: "side", "aria-label": "Properties and source" },
      this.resizer(
        "x",
        -1,
        RIGHT,
        () => this.rightWidth,
        (width) => {
          this.widths.right = width;
          this.shell.remember(this.text ? "right-width-text" : "right-width", String(width));
        },
      ),
      this.section("properties", "Properties", [], this.inspector.element),
      this.makeSplitter(),
      this.section(
        "source",
        "Source",
        [
          this.problems,
          iconButton(
            "help",
            { tip: "Guide: the rules and the syntax of this diagram", key: "F1" },
            () => this.guide.toggle(),
            "button small",
          ),
          this.expand,
        ],
        sourceBox,
        // Over the foot of the source, so the text stays where it is when a problem comes and goes.
        h("div", { class: "strips" }, this.problem, this.warning),
      ),
    );
  }

  /** A section of the right panel, whose header folds it. */
  private section(
    which: "properties" | "source",
    name: string,
    extras: HTMLElement[],
    ...body: HTMLElement[]
  ) {
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
  }

  /** The handle between Properties and Source: a drag shares the panel, a double click shares it evenly. */
  private makeSplitter() {
    const splitter = h("div", { class: "splitter", role: "separator" }),
      share = (split: number) => {
        this.split = split;
        this.wide = false;
        this.shell.remember("split", split ? String(split) : "");
        this.shell.remember("source-wide", "off");
        this.arrange();
      };
    this.dragging(
      splitter,
      "y",
      1,
      () => this.sections.get("properties")!.getBoundingClientRect().height,
      (height) => {
        const most = this.sidePanel.getBoundingClientRect().height - SECTION;
        share(Math.round(Math.max(SECTION, Math.min(height, most))));
      },
      () => share(0),
    );
    return splitter;
  }

  /** What lies over the canvas, and what a press on it or the pointer over it does to the window. */
  private coverStage() {
    const { stage, editor } = this;
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
  }

  /** Lays the window out as it was chosen on an earlier visit, and as the window's size allows. */
  private recallLayout() {
    const { shell, editor } = this,
      number = (key: string, start: number) => Number(shell.recall(key)) || start;
    this.left = this.leftStart;
    this.side = shell.recall("side") !== "closed";
    this.open.source = shell.recall("source-open") !== "closed";
    this.widths.left = number("left-width", 0);
    this.split = number("split", 0);
    this.wide = shell.recall("source-wide") === "on";
    editor.snapping = shell.recall("snap") !== "off";
    editor.view.grid = shell.recall("grid") !== "off";
    window.addEventListener("resize", () => this.resized());
    this.narrow = window.innerWidth < NARROW;
    this.tiny = window.innerWidth < TINY;
    this.small = window.innerWidth < SMALL;
    if (this.narrow) this.left = "";
    if (this.tiny) this.side = false;
  }

  /** The window changed its size: a panel that comes to lie over the canvas, or no longer does, starts again. */
  private resized() {
    const narrow = window.innerWidth < NARROW,
      tiny = window.innerWidth < TINY,
      small = window.innerWidth < SMALL;
    if (narrow === this.narrow && tiny === this.tiny && small === this.small) return this.arrange();
    this.narrow = narrow;
    this.tiny = tiny;
    this.small = small;
    // A panel that comes to lie over the canvas starts closed; with room beside it, it is back as it was.
    this.left = narrow ? "" : this.leftStart;
    this.side = !tiny && this.shell.recall("side") !== "closed";
    this.arrange();
  }

  /** What the editor asks of the window: notices, menus, help, text fields, and what follows the view. */
  private hookEditor() {
    const { editor } = this;
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
  }

  // The keyboard.

  /**
   * The keys of the window: saving, opening, a new diagram, the list of commands, the menu bar and
   * the zoom. They are handled here, before anything else sees them, because what they do depends on
   * what is open: under a dialog they do nothing, and a menu closes before they act. The browser
   * never gets them, so it shows no dialog of its own for Ctrl+S or Ctrl+O.
   */
  private shortcuts() {
    /** Whether Alt went down and nothing else since: its release then goes to the menu bar. */
    let alone = false;
    const bindings = this.bindings();
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") this.dismissWelcome();
        if (keptByDialog(event)) return;
        alone = event.key === "Alt" && !/[CS]/.test(modifiers(event));
        // While Alt is held the menus show their letters. Alt is kept from the browser's own menu.
        this.root.classList.toggle("alt", alone && !dialogOpen());
        if (event.key === "Alt") return event.preventDefault();
        this.press(event, bindings);
      },
      true,
    );
    window.addEventListener(
      "keyup",
      (event) => {
        if (event.key !== "Alt") return;
        this.root.classList.remove("alt");
        if (!alone) return;
        alone = false;
        event.preventDefault();
        if (!dialogOpen()) this.focusBar();
      },
      true,
    );
    const released = () => {
      alone = false;
      this.root.classList.remove("alt");
    };
    window.addEventListener("pointerdown", released, true);
    window.addEventListener("blur", released);
  }

  /** The keys of the window, with the modifiers each is pressed with. */
  private bindings(): Binding[] {
    const { shell } = this;
    return [
      {
        keys: ["s"],
        with: ["C", "CS"],
        run: (event) => (event.shiftKey ? shell.saveFileAs() : shell.saveFile()),
      },
      { keys: ["o"], with: ["C"], run: () => shell.openFile() },
      // With Alt held the key may type another letter: the key's place says it is N.
      { keys: ["n"], code: "KeyN", with: ["CA", "CAS"], run: () => this.chooser() },
      { keys: ["k"], with: ["C"], run: () => commandDialog(this.menus.commands()) },
      { keys: ["F10"], with: [""], run: () => this.focusBar() },
      { keys: ["F1"], with: [""], run: () => this.guide.toggle() },
      {
        keys: ["+", "=", "-"],
        with: ["", "C", "S", "CS"],
        canvas: true,
        run: (_, key) => this.editor.view.zoomStep(key === "-" ? -1 : 1),
      },
    ];
  }

  /** A key went down outside a dialog: a menu's letter, or a key of the window. */
  private press(event: KeyboardEvent, bindings: Binding[]) {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key,
      held = modifiers(event);
    if (held === "A" && /^[a-z]$/.test(key)) return this.pressLetter(event, key);
    const binding = bindings.find((item) => bound(item, event, key, held));
    if (!binding || keptFromCanvas(binding, event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!actsUnderDialog(key)) return;
    closeMenu();
    binding.run(event, key);
  }

  /** Alt with the first letter of a menu opens it. */
  private pressLetter(event: KeyboardEvent, letter: string) {
    if (dialogOpen() || !this.mnemonic(letter)) return;
    event.preventDefault();
    event.stopPropagation();
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

  /**
   * Greets a first visit: what the sample is, what to try, and where a diagram of one's own
   * starts. It is a strip along the foot of the canvas, and the diagram is fitted above it.
   */
  private greet() {
    this.welcome = h(
      "aside",
      { class: "welcome", "aria-label": "Welcome" },
      h(
        "p",
        {},
        h("strong", {}, "Welcome. "),
        "This is a sample to try things on: drag an element to move it, drag a dot beside it to connect, double-click to rename.",
      ),
      h(
        "button",
        {
          class: "button primary",
          type: "button",
          ...tipped({ tip: "Start a diagram of your own", key: "Ctrl+Alt+N", side: "top" }),
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
    );
    this.stage.append(this.welcome);
    new ResizeObserver(() => this.reserve()).observe(this.welcome);
  }

  /** Keeps the foot of the canvas free for the greeting while it shows: the diagram is fitted above it. */
  private reserve() {
    const height = this.welcome?.offsetHeight ?? 0;
    this.stage.style.setProperty("--foot", `${height ? height + 12 : 0}px`);
    this.editor.view.setInsets(0, height ? height + 12 : 0);
  }

  /** Puts the greeting away for good. */
  private dismissWelcome() {
    if (!this.welcome) return;
    this.welcome.remove();
    this.welcome = undefined;
    this.reserve();
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

  /** The tab the left panel starts with: the one chosen on an earlier visit, else Shapes where the window has room for it. */
  private get leftStart(): "shapes" | "outline" | "" {
    const chosen = this.shell.recall("left") ?? (window.innerWidth < SMALL ? "none" : "shapes");
    return chosen === "shapes" || chosen === "outline" ? chosen : "";
  }

  /** The width of the left panel: the one it was dragged to, or the one it starts with. */
  private get leftWidth() {
    return this.widths.left || LEFT.start;
  }

  /**
   * The width of the right panel: the one it was dragged to, or the one it starts with, which is
   * less in a small window. Text needs room to be read.
   */
  private get rightWidth() {
    return (
      this.widths.right ||
      (this.text ? RIGHT.text : window.innerWidth < SMALL ? RIGHT.small : RIGHT.start)
    );
  }

  /** Lays the window out as its state says: which panels show, how wide, and what the rail marks. */
  private arrange() {
    this.arrangePanels();
    this.markRail();
    this.arrangeSections();
  }

  /** The widths of the panels, and whether they show beside the canvas or over it. */
  private arrangePanels() {
    const { root } = this,
      left = !!this.left,
      beside = left && !this.narrow,
      wide = this.leftWidth,
      // The canvas keeps a part of the window, whatever the panels were dragged to.
      room = Math.max(RIGHT.least, window.innerWidth - 44 - (beside ? wide : 0) - 240),
      right = Math.min(this.rightWidth, this.tiny ? window.innerWidth - 44 : room);
    root.classList.toggle("left-over", this.narrow);
    root.classList.toggle("side-over", this.tiny);
    root.style.setProperty("--left", beside ? `${wide}px` : "0px");
    root.style.setProperty("--right", this.side && !this.tiny ? `${right}px` : "0px");
    this.leftPanel.style.width = `${wide}px`;
    this.sidePanel.style.width = `${right}px`;
    this.leftPanel.hidden = !left;
    this.sidePanel.hidden = !this.side;
  }

  /** The tabs of the left panel and the toggles of the rail say what shows. */
  private markRail() {
    for (const [which, control] of this.tabs)
      control.setAttribute("aria-selected", String(this.left === which));
    this.palette.element.hidden = this.left !== "shapes";
    this.outline.element.hidden = this.left !== "outline";
    this.toggles.get("shapes")!.setAttribute("aria-pressed", String(this.left === "shapes"));
    this.toggles.get("outline")!.setAttribute("aria-pressed", String(this.left === "outline"));
    this.toggles.get("side")!.setAttribute("aria-pressed", String(this.side));
  }

  /** Properties keeps its height above the source; alone, either takes the panel. */
  private arrangeSections() {
    const properties = this.sections.get("properties")!,
      source = this.sections.get("source")!,
      both = this.open.properties && this.open.source;
    properties.classList.toggle("closed", !this.open.properties);
    source.classList.toggle("closed", !this.open.source);
    properties.style.flex = both ? `0 0 ${this.propertiesHeight}` : "";
    this.expand.setAttribute("aria-pressed", String(this.wide));
    this.sidePanel.classList.toggle("split", both);
    for (const [which, made] of this.sections)
      made.querySelector(".fold")!.setAttribute("aria-expanded", String(this.open[which]));
  }

  /** The height of Properties above the source: little while the source is wide, else as dragged or half. */
  private get propertiesHeight() {
    if (this.wide) return EXPANDED;
    return this.split ? `${this.split}px` : "50%";
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
   * pointer is on it, and goes at once by its close button. A notice that offers a step stays
   * beside a later one that offers none, and goes when the source it was made for is no longer on
   * show: its step is then not the last one.
   */
  toast(message: string, action?: ToastAction) {
    let timer: number | undefined;
    const gone = () => {
      window.clearTimeout(timer);
      note.remove();
      this.offers = this.offers.filter((offer) => offer.note !== note);
    };
    const wait = () => {
      timer = window.setTimeout(gone, action ? 8000 : 5000);
    };
    const note: HTMLElement = h(
      "div",
      {
        class: action ? "toast offer" : "toast",
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
              gone();
              action.run();
              this.editor.view.canvas.focus({ preventScroll: true });
            },
          },
          action.name,
        ),
      iconButton("close", { tip: "Close", side: "top" }, gone, "toast-close"),
    );
    // One of each at a time: a notice takes the place of a notice, an offer that of an offer.
    for (const other of [...this.toasts.children])
      if (other.classList.contains("offer") === !!action) other.remove();
    if (action) this.offers = [{ note, source: this.editor.doc.source }];
    this.toasts.append(note);
    wait();
  }

  /** A step of the history is about to be taken: what was selected in the source it leads to is selected again. */
  stepped() {
    this.stepping = true;
  }

  /**
   * Remembers what is selected in the source on show, and after a step of the history selects
   * what was selected when that source was on show last, as far as it is still there.
   */
  private reselect() {
    const { editor } = this,
      { doc } = editor,
      { picture } = doc;
    if (doc.problem) this.stepping = false;
    if (!picture || doc.problem || picture.source !== doc.source) return;
    if (this.stepping) {
      this.stepping = false;
      // Selecting shows the state again, which comes back here with the step taken.
      if (this.selectAgain(picture)) return;
    }
    this.selections.delete(doc.source);
    this.selections.set(doc.source, editor.selection);
    if (this.selections.size > REMEMBERED)
      this.selections.delete(this.selections.keys().next().value!);
  }

  /** Selects what was selected when the source on show was on show last; false when nothing changes. */
  private selectAgain(picture: NonNullable<Editor["doc"]["picture"]>) {
    const { editor } = this,
      parts = (this.selections.get(editor.doc.source) ?? []).filter((part) =>
        part.type === "element"
          ? picture.diagram.nodes.has(part.id)
          : picture.diagram.edges.some((edge) => edge.id === part.id),
      ),
      same =
        parts.length === editor.selection.length && parts.every((part) => editor.isSelected(part));
    if (!parts.length || same) return false;
    editor.select(parts);
    return true;
  }

  /**
   * Shows the groups of the properties folded or open, as their titles were left: a title is a
   * control that folds its group, with an arrow that says which way.
   */
  private foldGroups() {
    for (const group of this.inspector.element.querySelectorAll<HTMLElement>(".group")) {
      const title = group.querySelector<HTMLElement>(":scope > h3");
      if (!title) continue;
      if (!title.querySelector(".icon")) {
        title.prepend(icon("chevron"));
        title.tabIndex = 0;
        title.setAttribute("role", "button");
      }
      const closed = this.folded.has(title.textContent ?? "");
      group.classList.toggle("closed", closed);
      title.setAttribute("aria-expanded", String(!closed));
    }
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

  /** Whether the page is dark now, by choice or by the system's. */
  private get dark() {
    return document.documentElement.dataset.theme === "dark";
  }

  /** The theme button shows the mode a click switches to: the moon in light mode, the sun in dark. */
  private showTheme() {
    const tip = this.dark ? "Light mode" : "Dark mode";
    this.themeToggle.replaceChildren(icon(this.dark ? "sun" : "theme"));
    this.themeToggle.dataset.tip = tip;
    this.themeToggle.setAttribute("aria-label", tip);
  }

  /** Shows the editor's state: called whenever it changed. */
  update() {
    this.showTheme();
    const { editor } = this,
      info = typeInfo(editor.type),
      text = info.mode === "text",
      earlier = this.earlier();
    this.reselect();
    this.dropOffers();
    if (text !== this.text) this.switchMode(text);
    this.showTools(text, info.plural);
    this.showDocument(earlier ? typeInfo(earlier.type) : info);
    if (!this.typing && this.source.setText(editor.doc.source)) this.lines = "replaced";
    const problem = this.sayProblem();
    this.markSelected();
    this.showStrips(problem);
    this.showStage(problem, earlier, text);
    // The shapes stay those of the picture on show until the source reads as its new type.
    if (!earlier) this.palette.update();
    this.outline.update();
    this.inspector.update();
    this.foldGroups();
    this.status.update();
    this.minimap.draw();
    this.showAway();
  }

  /** The picture of an earlier type that shows under an error: the window stays that type's. */
  private earlier() {
    const { doc, type } = this.editor;
    return doc.problem && doc.picture && !sameType(doc.picture.type, type)
      ? doc.picture
      : undefined;
  }

  /** An offer of a step goes when its source is no longer the one on show. */
  private dropOffers() {
    const { source } = this.editor.doc;
    for (const offer of this.offers) if (offer.source !== source) offer.note.remove();
    this.offers = this.offers.filter((offer) => offer.source === source);
  }

  /**
   * The diagram on show became one edited as text, or one edited on the canvas. Text needs room to
   * be read, and has no properties to show: the right panel starts wider, the source alone.
   */
  private switchMode(text: boolean) {
    const { shell } = this,
      first = this.text === undefined;
    this.text = text;
    this.widths.right = Number(shell.recall(text ? "right-width-text" : "right-width")) || 0;
    this.open.properties =
      (shell.recall(text ? "properties-text" : "properties") ?? (text ? "closed" : "open")) ===
      "open";
    this.arrange();
    if (!first) void this.editor.fitSoon();
  }

  /** The tools of the rail, the history's buttons and the bar's menus: which are on. */
  private showTools(text: boolean, plural: string) {
    const { editor } = this;
    for (const [tool, control] of this.tools) {
      control.setAttribute("aria-pressed", String(tool === editor.tool));
      setOff(control, text && tool !== "pan" && `${plural} are edited as text`);
    }
    setOff(this.undo, !editor.doc.canUndo);
    setOff(this.redo, !editor.doc.canRedo);
    for (const menu of this.menus.bar()) {
      const title = this.titles.get(menu.name)!;
      setOff(title, menu.off);
      title.dataset.side = "bottom";
    }
  }

  /** The document in the bar: its title, its type, whether it is saved, and its file. */
  private showDocument(shown: ReturnType<typeof typeInfo>) {
    const { editor, shell } = this,
      file = shell.fileName;
    if (document.activeElement !== this.title) this.title.value = editor.doc.picture?.title ?? "";
    this.sizeTitle();
    this.chip.replaceChildren(icon(shown.icon), h("span", {}, shown.name), icon("chevron"));
    Object.assign(this.chip.dataset, { tip: `${shown.about}. Click for a new diagram.` });
    this.dot.hidden = !shell.unsaved;
    this.fileName.textContent = file ?? "";
    this.fileName.hidden = !file;
    if (file) this.fileName.dataset.tip = `Saved to ${file}`;
  }

  /**
   * Marks the problem in the source, and returns it. An error made by typing shows when the typing
   * has rested, or the cursor has left its line: a statement half typed is no error yet. One that
   * goes, goes at once.
   */
  private sayProblem() {
    const { problem } = this.editor.doc,
      waiting =
        !!problem &&
        this.source.focused &&
        performance.now() - this.typedAt < REST &&
        this.said?.message !== problem.message;
    if (!waiting) this.said = problem;
    this.source.setProblem(this.said);
    return this.said;
  }

  /**
   * The lines of what is selected on the canvas are marked in the source: where an element is
   * declared, and where a connection is said.
   */
  private markSelected() {
    const lines = this.editor.doc.problem ? [] : this.selectedLines();
    if (lines.join() === this.lines) return;
    this.lines = lines.join();
    this.source.setSelectedLines(lines);
  }

  /** The lines that declare the selected elements and say the selected connections. */
  private selectedLines(): number[] {
    const { editor } = this,
      diagram = editor.doc.picture?.diagram,
      declared = this.declared();
    return [
      ...editor.selectedElements.flatMap(
        (id) => declared.get(id) ?? diagram?.nodes.get(id)?.line ?? [],
      ),
      ...editor.selectedWires.flatMap(
        (id) => diagram?.edges.find((edge) => edge.id === id)?.line ?? [],
      ),
    ];
  }

  /** The strips over the foot of the source: the problem on show, and elements that overlap. */
  private showStrips(problem: Problem | undefined) {
    const { doc } = this.editor,
      message = problem?.message ?? "";
    if (this.problem.dataset.said !== message) {
      this.problem.dataset.said = message;
      this.problem.replaceChildren(...prose(message));
      this.problem.classList.remove("whole");
    }
    this.problem.hidden = !problem;
    // Not an error of the source, but not TAM either: elements that lie on each other.
    const names = this.overlapping();
    this.warning.textContent = names
      ? `“${names[0]}” and “${names[1]}” overlap. TAM places all elements apart.`
      : "";
    this.warning.hidden = !names || !!doc.problem;
    if (this.warning.hidden) this.warning.classList.remove("whole");
    this.problems.textContent = doc.problem ? "1 problem" : "";
    this.problems.hidden = !doc.problem;
  }

  /** The names of the first two elements that lie on each other, if any do. */
  private overlapping() {
    const { picture } = this.editor.doc,
      [pair] = picture?.overlaps ?? [];
    return pair?.map((id) => {
      const node = picture!.diagram.nodes.get(id);
      return (node?.label || node?.origin || id).replace(/<br\s*\/?>/gi, " ");
    });
  }

  /** What lies over the canvas: the banner of an error, the label of a preview, the word of an empty diagram. */
  private showStage(
    problem: Problem | undefined,
    earlier: Editor["doc"]["picture"],
    text: boolean,
  ) {
    const { doc } = this.editor;
    // An error leaves the last good picture on show, dimmed, with a banner that says so.
    this.stage.classList.toggle("stale", !!problem);
    this.banner.hidden = !problem;
    this.banner.textContent = problem ? this.bannerText(problem, !!earlier) : "";
    this.preview.hidden = !text;
    const none = !doc.problem && !!doc.picture && !doc.picture.scene.shapes.length;
    if (this.empty.hidden !== !none || !this.empty.childElementCount)
      this.empty.replaceChildren(h("strong", {}, "An empty diagram"), ...this.emptyHint(text));
    this.empty.hidden = !none;
  }

  /** What the banner says of an error: where it is, and what shows meanwhile. */
  private bannerText(problem: Problem, earlier: boolean) {
    const where = problem.line ? ` on line ${problem.line}` : "",
      showing = this.editor.doc.picture
        ? ` Showing the last valid diagram${earlier ? " of the previous type" : ""}.`
        : "";
    return `The source has an error${where}.${showing}`;
  }

  /** How an empty diagram gets its first part, as the type on show is edited. */
  private emptyHint(text: boolean): HTMLElement[] {
    const { editor } = this;
    if (text) return [h("span", {}, "Type in the source, or add a snippet from the left.")];
    if (editor.structural)
      return [
        h(
          "span",
          {},
          `Click a shape on the left, or double-click here, to add the first ${
            editor.structure?.pieces[0]?.name.toLowerCase() ?? "part"
          }.`,
        ),
      ];
    return [
      h("span", {}, "Drag a shape here from the left, or double-click for an agent."),
      h(
        "span",
        { class: "note" },
        "Positions are written into the source as ",
        h("code", {}, "@x,y"),
        "; without them the layout is automatic.",
      ),
    ];
  }
}
