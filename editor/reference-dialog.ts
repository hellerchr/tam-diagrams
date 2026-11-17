/**
 * The guide sheet: the reference guide of a diagram type (reference.ts) in a panel beside the
 * source, to read while typing. It lists the sections of a guide with links to each, colors its
 * code as the source pane does, narrows its rows to what a filter says, and copies a row or writes
 * it into the source.
 */

import { h, icon, iconButton, prose, tipped } from "./dom.ts";
import { choiceButton } from "./menu.ts";
import {
  type Guide,
  type GuideRow,
  type GuideSection,
  GUIDES,
  guideOf,
  rowSource,
} from "./reference.ts";
import { scanSource } from "./syntax.ts";
import { type DiagramType, sameType, typeInfo, typeOf } from "./types.ts";

/** What the sheet asks of the window around it. */
export interface GuideHost {
  /** The type of the diagram on show. */
  type(): DiagramType;
  /** Writes statements into the source, at its cursor. */
  insert(text: string): void;
  /** Shows a whole example in place of the diagram, asking first when that loses something; `at` is the control that asked. */
  example(source: string, at: HTMLElement): void;
  /** Says something for a few seconds. */
  notify(message: string): void;
  /** The sheet opened or closed. */
  shown(open: boolean): void;
}

/** What the sheet shows: the guide of a type, or the list of all guides. */
type Page = DiagramType | "all";

/** Code with the colors of the source pane: the tokens of some lines of a source of a type. */
function colored(type: DiagramType, source: string, first: number, count: number): Node[] {
  const texts = source.split("\n").slice(first, first + count),
    tokens = scanSource(type, source).lines.slice(first, first + count),
    out: Node[] = [];
  texts.forEach((text, index) => {
    let at = 0;
    for (const token of tokens[index] ?? []) {
      if (token.from > at) out.push(document.createTextNode(text.slice(at, token.from)));
      out.push(h("span", { class: `tok-${token.tag.split(".")[0]}` }, token.text));
      at = token.to;
    }
    out.push(document.createTextNode(text.slice(at) + (index < texts.length - 1 ? "\n" : "")));
  });
  return out;
}

/** The code of a row, colored as it reads among the lines it stands in. */
function rowCode(guide: Guide, section: GuideSection, item: GuideRow): Node[] {
  if (item.fragment) return [document.createTextNode(item.write)];
  const before = rowSource(guide, section, { ...item, write: "", after: undefined }),
    source = rowSource(guide, section, item),
    // A row read under another first line of the type is colored as that one: the lanes of an activity.
    kind = guide.type === "tam" ? guide.type : typeOf(source);
  return colored(
    sameType(kind, guide.type) ? kind : guide.type,
    source,
    before ? before.split("\n").length : 0,
    item.write.split("\n").length,
  );
}

/** Whether a row is written into the source: a statement the parser reads is; a sign on its own or a refused one is only copied. */
const writes = (item: GuideRow) => !item.fragment && !item.refused;

/** Whether a row takes the whole width: code of several lines, or of one long line. */
const wide = (item: GuideRow) => item.write.includes("\n") || item.write.length > 20;

export class GuideSheet {
  readonly element: HTMLElement;
  private readonly host: GuideHost;
  private page: Page = "all";
  /** What had the focus before the sheet opened: it gets the focus back. */
  private origin: HTMLElement | undefined;
  private readonly chooser = choiceButton<Page>((page) => this.show(page));
  private readonly filter = h("input", {
    class: "field",
    type: "text",
    spellcheck: "false",
    placeholder: "Filter this guide",
    "aria-label": "Filter this guide",
  });
  private readonly count = h("span", { class: "guide-count" });
  private readonly tools = h("div", { class: "guide-tools" }, this.filter, this.count);
  private readonly nav = h("nav", { class: "guide-nav", "aria-label": "Sections" });
  private readonly body = h("div", { class: "guide-body" });

  constructor(host: GuideHost) {
    this.host = host;
    this.chooser.element.setAttribute("aria-label", "Guide of");
    this.element = h(
      "aside",
      { class: "guide", "aria-label": "Guide", hidden: true },
      h(
        "header",
        { class: "guide-head" },
        icon("help"),
        h("h2", {}, "Guide"),
        this.chooser.element,
        iconButton(
          "close",
          { tip: "Close the guide", key: "Esc" },
          () => this.close(),
          "button small",
        ),
      ),
      this.tools,
      this.nav,
      this.body,
    );
    this.filter.addEventListener("input", () => this.narrow());
    this.element.addEventListener("keydown", (event) => this.key(event));
  }

  get isOpen() {
    return !this.element.hidden;
  }

  /** The guide on show; undefined while the sheet is closed or lists all guides. */
  get type(): DiagramType | undefined {
    return this.isOpen && this.page !== "all" ? this.page : undefined;
  }

  /** Opens the sheet with the guide of a type, or with the list of all guides, and takes the focus. */
  open(page: Page = this.host.type()) {
    if (!this.isOpen) {
      const active = document.activeElement;
      this.origin = active instanceof HTMLElement && active !== document.body ? active : undefined;
      this.element.hidden = false;
      this.host.shown(true);
    }
    this.show(page);
    (this.page === "all" ? this.body.querySelector<HTMLElement>("button") : this.filter)?.focus();
  }

  /** Closes the sheet; the focus goes back where it was. */
  close() {
    if (!this.isOpen) return;
    const inside = this.element.contains(document.activeElement);
    this.element.hidden = true;
    this.host.shown(false);
    if (inside && this.origin?.isConnected) this.origin.focus();
    this.origin = undefined;
  }

  /** Opens the guide of the diagram on show, or closes the sheet when it shows that guide. */
  toggle() {
    if (this.type && sameType(this.type, this.host.type())) this.close();
    else this.open();
  }

  /** Shows a guide, or the list of all, from its top. */
  private show(page: Page) {
    const guide = page === "all" ? undefined : guideOf(page);
    this.page = guide ? guide.type : "all";
    this.chooser.show(
      [
        ...GUIDES.map((item) => ({ value: item.type as Page, name: item.name })),
        { value: "all", name: "All guides" },
      ],
      this.page,
    );
    this.filter.value = "";
    this.tools.hidden = this.nav.hidden = !guide;
    this.body.replaceChildren(...(guide ? this.sections(guide) : [this.index()]));
    this.nav.replaceChildren(
      ...(guide?.sections ?? []).map((section) =>
        // The link says the section in a word: its id; its tooltip says the title.
        h(
          "button",
          {
            class: "guide-link",
            type: "button",
            ...tipped({ tip: section.title, side: "top" }),
            onClick: () => this.jump(section.id),
          },
          section.id[0].toUpperCase() + section.id.slice(1),
        ),
      ),
    );
    this.body.scrollTop = 0;
    this.narrow();
  }

  /** The list of all guides: each with what its diagram shows. */
  private index(): HTMLElement {
    return h(
      "div",
      { class: "guide-index" },
      ...GUIDES.map((guide) =>
        h(
          "button",
          { class: "guide-entry", type: "button", onClick: () => this.open(guide.type) },
          icon(typeInfo(guide.type).icon),
          h("span", {}, h("strong", {}, guide.name), h("span", { class: "note" }, guide.about)),
        ),
      ),
    );
  }

  /** The sections of a guide. */
  private sections(guide: Guide): HTMLElement[] {
    return guide.sections.map((section) => {
      const refused = !!section.rows?.length && section.rows.every((item) => item.refused);
      return h(
        "section",
        { id: `guide-${section.id}`, "data-title": section.title.toLowerCase() },
        h("h3", {}, section.title),
        section.prose && h("p", { class: "guide-prose" }, ...prose(section.prose)),
        section.rules &&
          h(
            "ul",
            { class: "guide-rules" },
            ...section.rules.map((rule) => h("li", {}, ...prose(rule))),
          ),
        !!section.rows?.length &&
          h(
            "div",
            { class: refused ? "guide-rows refused" : "guide-rows", role: "list" },
            ...section.rows.map((item) => this.row(guide, section, item)),
          ),
        section.example && this.example(guide, section.example),
      );
    });
  }

  /** A row: its code, what it means, and the buttons that copy it and write it into the source. */
  private row(guide: Guide, section: GuideSection, item: GuideRow): HTMLElement {
    const made = h(
      "div",
      {
        class: `guide-row${wide(item) ? " wide" : ""}`,
        role: "listitem",
        tabindex: "-1",
        "data-text": `${item.write}\n${item.means}`.toLowerCase(),
      },
      h("code", { class: "guide-code" }, ...rowCode(guide, section, item)),
      h("span", { class: "guide-means" }, ...prose(item.means)),
      h(
        "span",
        { class: "guide-acts" },
        writes(item) &&
          this.act("plus", "Insert into the source", "Enter", () => this.insert(guide, item.write)),
        this.act("copy", "Copy", "C", () => this.copy(item.write)),
      ),
    );
    made.addEventListener("keydown", (event) => this.rowKey(event, made, guide, item));
    return made;
  }

  /** A key on a row: Enter writes it into the source, where it is a statement to write; C copies it. */
  private rowKey(event: KeyboardEvent, made: HTMLElement, guide: Guide, item: GuideRow) {
    if (event.target !== made || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Enter" && writes(item)) this.insert(guide, item.write);
    else if (event.key.toLowerCase() === "c") this.copy(item.write);
    else return;
    event.preventDefault();
  }

  /** A button of a row. The keyboard reaches what it does through its row. */
  private act(name: "plus" | "copy", tip: string, key: string, run: () => void): HTMLElement {
    const button = iconButton(name, { tip, key, side: "top" }, run, "button small");
    button.tabIndex = -1;
    return button;
  }

  /** The whole example of a guide, with the buttons that copy it and show it as the diagram. */
  private example(guide: Guide, source: string): HTMLElement {
    const use = h(
      "button",
      {
        class: "button outlined",
        type: "button",
        ...tipped({ tip: "Show this example in place of the diagram" }),
      },
      "Open as diagram",
    );
    use.addEventListener("click", () => this.host.example(source, use));
    return h(
      "div",
      { class: "guide-example", "data-text": source.toLowerCase() },
      h(
        "pre",
        {},
        h(
          "code",
          { class: "guide-code" },
          ...colored(guide.type, source, 0, source.split("\n").length),
        ),
      ),
      h(
        "div",
        { class: "guide-example-acts" },
        h(
          "button",
          { class: "button outlined", type: "button", onClick: () => this.copy(source) },
          icon("copy"),
          h("span", {}, "Copy"),
        ),
        use,
      ),
    );
  }

  /** Writes a row into the source, when the source is of the guide's type. */
  private insert(guide: Guide, text: string) {
    const type = this.host.type();
    if (!sameType(type, guide.type))
      return this.host.notify(
        `This is ${lower(guide.name)} syntax; the diagram on show is ${article(lower(typeInfo(type).name))}.`,
      );
    this.host.insert(text);
  }

  private copy(text: string) {
    void (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("No clipboard."))).then(
      () => this.host.notify("Copied."),
      () => this.host.notify("The browser did not let the page copy."),
    );
  }

  /** Brings a section to the top, with the focus on its first row. */
  private jump(id: string) {
    const section = this.body.querySelector<HTMLElement>(`#guide-${id}`);
    if (!section) return;
    this.body.scrollTop = section.offsetTop;
    this.rows(section)[0]?.focus({ preventScroll: true });
  }

  /** The rows on show, of the guide or of a part of it, in their order. */
  private rows(within: HTMLElement = this.body): HTMLElement[] {
    return [...within.querySelectorAll<HTMLElement>(".guide-row")].filter(
      (item) => !item.hidden && !item.closest("section[hidden]"),
    );
  }

  /**
   * Narrows the guide to what the filter says: the rows, rules and examples that have every word
   * of it, in the sections that have any; a section whose title has the words shows whole.
   */
  private narrow() {
    const words = this.filter.value.toLowerCase().split(/\s+/).filter(Boolean);
    let found = 0;
    for (const section of this.body.querySelectorAll<HTMLElement>("section"))
      found += narrowSection(section, words);
    this.count.textContent = rowCount(words, found);
    // One row is the stop of Tab; the arrow keys go from row to row.
    const rows = this.rows();
    rows.forEach((item, index) => (item.tabIndex = index ? -1 : 0));
  }

  /** The keys of the sheet: Escape clears the filter, then closes; the arrows go from row to row. */
  private key(event: KeyboardEvent) {
    // A key pressed in the sheet is the sheet's: the canvas does not act on it.
    event.stopPropagation();
    if (event.key === "Escape") return this.escape(event);
    const target = event.target as HTMLElement,
      rows = this.rows(),
      at = rows.indexOf(target),
      next = this.stopAfter(event.key, rows, at, target);
    if (!next) return;
    event.preventDefault();
    if (at >= 0) rows[at].tabIndex = -1;
    if (next !== this.filter) next.tabIndex = 0;
    else if (rows[0]) rows[0].tabIndex = 0;
    next.focus();
  }

  /** Escape clears the filter, and closes the sheet where the filter is clear. */
  private escape(event: KeyboardEvent) {
    event.preventDefault();
    if (!this.filter.value) return this.close();
    this.filter.value = "";
    this.narrow();
    this.filter.focus();
  }

  /**
   * Where a key goes from the row at `at` of the rows on show, or from `from` where that is no
   * row: up and down, to the first and to the last. From the filter the arrow down goes to the
   * first row, and up from the first row goes to the filter.
   */
  private stopAfter(key: string, rows: HTMLElement[], at: number, from: HTMLElement) {
    if (key === "ArrowDown") return at >= 0 || from === this.filter ? rows[at + 1] : undefined;
    if (at < 0) return undefined;
    if (key === "ArrowUp") return rows[at - 1] ?? this.filter;
    if (key === "Home") return rows[0];
    return key === "End" ? rows.at(-1) : undefined;
  }
}

/** The text a part of the guide is found by: what its row or example says, else its words. */
const findable = (item: HTMLElement) => item.dataset.text ?? item.textContent?.toLowerCase() ?? "";

/**
 * Narrows a section to the words of a filter: what has every word shows, and the whole section
 * where its title has them; a section with nothing that shows is hidden. The rows that show.
 */
function narrowSection(section: HTMLElement, words: string[]): number {
  const has = (text: string) => words.every((word) => text.includes(word)),
    whole = !words.length || has(section.dataset.title ?? "");
  let any = whole,
    found = 0;
  for (const item of section.querySelectorAll<HTMLElement>("[data-text], li, .guide-prose")) {
    const shown = whole || has(findable(item));
    item.hidden = !shown;
    any ||= shown;
    if (shown && item.matches(".guide-row")) found++;
  }
  section.hidden = !any;
  return found;
}

/** How many rows the filter found, said under it; nothing while there is no filter. */
const rowCount = (words: string[], found: number) =>
  !words.length ? "" : found ? `${found} ${found === 1 ? "row" : "rows"}` : "Nothing";

/** The name of a diagram inside a sentence. */
const lower = (name: string) => (name.startsWith("TAM") ? name : name.toLowerCase());

/** A name with its article: "a class diagram", "an activity diagram". */
const article = (name: string) => `${/^[aeio]/i.test(name) ? "an" : "a"} ${name}`;
