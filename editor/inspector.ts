/**
 * The Properties section of the right panel: what is selected, with its properties in groups that
 * keep their order (Identity, Style, Geometry, Arrange, Interfaces), or the diagram's own
 * properties when nothing is selected.
 */

import type { Direction } from "../src/elk.ts";
import { COLORS, ELEMENT_KINDS, type TamNode } from "../src/tam.ts";
import type { ElementKind } from "../src/tam-edit.ts";
import { h, icon, iconButton, setOff, tipped } from "./dom.ts";
import type { Editor } from "./editor.ts";
import type { IconName } from "./icons.ts";
import { ARRANGE, arrangeRefusal, WIRES, wireChange, wireValue } from "./menus.ts";
import {
  classRelationEnds,
  classStereotype,
  setClassMultiplicity,
  setClassStereotype,
} from "../src/uml-class-edit.ts";
import type { Cardinality } from "../src/uml-er.ts";
import {
  erAttributes,
  erRelationshipEnds,
  setErAttributes,
  setErCardinality,
  setErIdentifying,
} from "../src/uml-er-edit.ts";
import { replyTo, toggleActivation } from "../src/uml-sequence-edit.ts";
import { setStateDescription, stateDescription } from "../src/uml-state-edit.ts";
import { pieceIcon } from "./structures.ts";
import { kindName, PLAIN_KINDS, typeInfo } from "./types.ts";

/** The cardinalities of an end of a relationship, as the Properties name them. */
const CARDINALITY_NAMES: { value: Cardinality; name: string }[] = [
  { value: "only-one", name: "Exactly one" },
  { value: "zero-or-one", name: "Zero or one" },
  { value: "one-or-more", name: "One or more" },
  { value: "zero-or-more", name: "Zero or more" },
];

/** What each level means in a diagram of a type, as the Level buttons' tooltips say it. */
const LEVELS: Partial<Record<string, { any: string; conceptual: string; design: string }>> = {
  tam: {
    any: "Conceptual and design level elements together",
    conceptual: "Agents, storages, channels and accesses only",
    design: "Components, interfaces and connectors",
  },
  class: {
    any: "No level: everything a class diagram has",
    conceptual:
      "Classes and their relations, without visibility, interfaces, templates, realization or dependencies",
    design: "Everything a class diagram has, as no level",
  },
  state: {
    any: "No level said",
    conceptual: "States and transitions, without fork or join bars",
    design: "State machines belong to the conceptual level in TAM",
  },
  usecase: {
    any: "No level said",
    conceptual: "Actors, use cases and their relations",
    design: "Use case diagrams belong to the conceptual level in TAM",
  },
  sequence: {
    any: "No level said",
    conceptual: "Messages between participants, without creating or destroying objects",
    design: "Objects created and destroyed too",
  },
  flowchart: {
    any: "No level said",
    conceptual: "TAM's conceptual level: what is done, by whom",
    design: "TAM's design level: how the system does it",
  },
};
LEVELS.swimlane = LEVELS.flowchart;

/** The words of a connection that is a channel, which goes by a protocol. */
const CHANNELS = ["calls", "sends data", "---", "requires"];

/** The lines of a list typed in a field, one entry a line. */
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** One of the buttons of a segmented control: a name or an icon, and what its tooltip says. */
interface Segment<T extends string> {
  value: T;
  name?: string;
  icon?: IconName;
  tip?: string;
}

/**
 * Whether Enter types a line break in a text field: in a list, where every line is an entry, Enter
 * starts the next; in another field of several lines Shift+Enter does.
 */
function entersLine(event: KeyboardEvent, multiline: boolean, list: boolean): boolean {
  return (list && !event.ctrlKey && !event.metaKey) || (multiline && event.shiftKey);
}

/** The keys of a text field: Enter takes what was typed, Escape puts back what it showed. */
function textKey(
  event: KeyboardEvent,
  field: HTMLInputElement | HTMLTextAreaElement,
  read: () => string,
  multiline: boolean,
  list: boolean,
) {
  if (event.key === "Enter") {
    if (entersLine(event, multiline, list)) return;
    event.preventDefault();
    field.blur();
  } else if (event.key === "Escape") {
    field.value = read();
    field.blur();
  }
}

export class Inspector {
  readonly element = h("div", { class: "inspector" });
  private readonly editor: Editor;
  private inspected = "";
  /** What brings the controls on show up to date with the document. */
  private sync: (() => void)[] = [];

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /** Shows the selection's properties: built again when the selection changed, brought up to date else. */
  update() {
    const key = this.selectionKey();
    if (key !== this.inspected || !this.element.childElementCount) {
      this.inspected = key;
      this.sync = [];
      this.element.replaceChildren(...this.pane());
    }
    // A field reads the source as it is; while that has an error it keeps what it showed.
    for (const sync of this.sync) {
      try {
        sync();
      } catch {
        // The source does not read at the moment.
      }
    }
  }

  /** What is selected, as a key. What a part is comes with its picture: a part just added is known once it is laid out. */
  private selectionKey() {
    const { editor } = this,
      { picture } = editor.doc,
      kindOf = (part: Editor["selection"][number]) =>
        (part.type === "wire"
          ? picture?.joins?.get(part.id)?.kind
          : picture?.parts?.get(part.id)?.kind) ?? "";
    return [
      editor.type,
      ...editor.selection.map((part) => `${part.type}:${part.id}:${kindOf(part)}`),
    ].join(" ");
  }

  /** The pane for what is selected. */
  private pane(): HTMLElement[] {
    const { editor } = this,
      elements = editor.selectedElements,
      wires = editor.selectedWires;
    if (editor.structural) return this.flowPane(elements, wires);
    if (!editor.editable) return this.textPane();
    if (wires.length === 1 && !elements.length) return this.wirePane(wires[0]);
    if (elements.length && !wires.length) return this.elementPane(elements);
    return editor.selection.length ? this.manyPane() : this.diagramPane();
  }

  /** What the pane is about: an icon and a name, above the groups. */
  private subject(name: IconName, title: string, detail = "") {
    return h(
      "div",
      { class: "subject" },
      icon(name),
      h("strong", {}, title),
      detail && h("span", {}, detail),
    );
  }

  /** A group of rows under a header. */
  private group(title: string, ...rows: (HTMLElement | false)[]) {
    return h("section", { class: "group" }, h("h3", {}, title), ...rows);
  }

  /** A labelled row of the inspector. */
  private row(label: string, control: HTMLElement, tag: "label" | "div" = "label") {
    return h(tag, { class: "row" }, h("span", {}, label), control);
  }

  /**
   * A text field that takes its value when it loses focus or on Enter, and shows `read()`
   * otherwise. A field for several lines is one line high and grows with the line breaks in it,
   * which Shift+Enter types; in a `list` Enter types them, and the field is taken when it is left.
   */
  private text(
    read: () => string,
    write: (value: string) => void,
    placeholder = "",
    multiline = false,
    list = false,
  ) {
    const field = multiline
      ? h("textarea", { class: "field", rows: "1", placeholder, spellcheck: "false" })
      : h("input", { class: "field", type: "text", placeholder, spellcheck: "false" });
    // As high as its lines, or as its placeholder's while it is empty.
    const fit = () => {
      if (multiline)
        field.setAttribute("rows", String((field.value || placeholder).split("\n").length));
    };
    const commit = () => {
      if (field.value !== read()) write(field.value);
    };
    field.addEventListener("change", commit);
    field.addEventListener("input", fit);
    field.addEventListener("keydown", (event) =>
      textKey(event as KeyboardEvent, field, read, multiline, list),
    );
    this.sync.push(() => {
      if (document.activeElement !== field) field.value = read();
      fit();
    });
    return field;
  }

  /**
   * A list to choose one of; elements that differ show as mixed, and a value that is none of
   * the list under the name given for it.
   */
  private choice<T extends string>(
    options: { value: T; name: string }[],
    read: () => T | "",
    write: (value: T) => void,
    allowed: (value: T) => boolean = () => true,
    none = "Mixed",
  ) {
    const items = options.map((option) => h("option", { value: option.value }, option.name)),
      mixed = h("option", { value: "", disabled: true }, none);
    const select = h(
      "select",
      { class: "field", onChange: () => write(select.value as T) },
      ...items,
    ) as HTMLSelectElement;
    this.sync.push(() => {
      // Only what the notation allows here is offered, and what is set.
      const current = read();
      select.replaceChildren(
        ...(current === "" ? [mixed] : []),
        ...items.filter((item) => item.value === current || allowed(item.value as T)),
      );
      select.value = current;
    });
    return select;
  }

  /** Buttons of which one is on, joined into one control. A button that is off says why. */
  private segments<T extends string>(
    options: Segment<T>[],
    read: () => T | undefined,
    write: (value: T) => void,
    refusal: (value: T) => string | undefined = () => undefined,
  ) {
    const controls = options.map((option) =>
      h(
        "button",
        {
          class: "segment",
          type: "button",
          ...(option.tip ? tipped({ tip: option.tip }) : {}),
          onClick: () => write(option.value),
        },
        option.icon && icon(option.icon),
        option.name,
      ),
    );
    this.sync.push(() =>
      controls.forEach((control, index) => {
        const on = options[index].value === read();
        control.setAttribute("aria-pressed", String(on));
        setOff(control, !on && refusal(options[index].value));
      }),
    );
    return h("div", { class: "segments" }, ...controls);
  }

  /** A button of a pane's actions. */
  private action(name: string, run: () => void) {
    return h("button", { class: "button outlined", type: "button", onClick: run }, name);
  }

  /** How many of each end's class a relation of a class diagram joins. */
  private multiplicities(id: string): HTMLElement[] {
    const { editor } = this,
      ends = () => classRelationEnds(editor.doc.source, id);
    if (!ends()) return [];
    return (["from", "to"] as const).map((end) =>
      this.row(
        end === "from" ? "At source" : "At target",
        this.text(
          () => ends()?.[end === "from" ? "fromMultiplicity" : "toMultiplicity"] ?? "",
          (text) => editor.amend((source) => setClassMultiplicity(source, id, end, text)),
          "1, 0..1, *",
        ),
      ),
    );
  }

  /**
   * How many of each end's entity a relationship of an entity relationship diagram joins, and
   * whether it identifies: a solid line, or a dashed one.
   */
  private cardinalities(id: string): HTMLElement[] {
    const { editor } = this,
      ends = () => erRelationshipEnds(editor.doc.source, id);
    if (!ends()) return [];
    const identifying = h("input", {
      type: "checkbox",
      onChange: () => editor.amend((source) => setErIdentifying(source, id, identifying.checked)),
    }) as HTMLInputElement;
    this.sync.push(() => {
      identifying.checked = !!ends()?.identifying;
    });
    return [
      ...(["from", "to"] as const).map((end) =>
        this.row(
          end === "from" ? "At source" : "At target",
          this.choice<Cardinality>(
            CARDINALITY_NAMES,
            () => ends()?.[end === "from" ? "fromCardinality" : "toCardinality"] ?? "",
            (cardinality) =>
              editor.amend((source) => setErCardinality(source, id, end, cardinality)),
          ),
        ),
      ),
      h(
        "label",
        {
          class: "row check",
          ...tipped({
            tip: "Identifying relationship, a solid line: the target entity type is existence-dependent on the source",
          }),
        },
        h("span", {}, "Identifying"),
        identifying,
      ),
    ];
  }

  private remove() {
    return h(
      "button",
      {
        class: "button outlined danger",
        type: "button",
        onClick: () => this.editor.deleteSelection(),
      },
      "Delete",
    );
  }

  /** The nodes of the selected elements, as the picture on show has them. */
  private nodes(ids: string[]): TamNode[] {
    const nodes = this.editor.doc.picture?.diagram.nodes;
    return ids.flatMap((id) => nodes?.get(id) ?? []);
  }

  /** What the selected elements have in common; undefined where they differ. */
  private shared<T>(ids: string[], read: (node: TamNode) => T): T | undefined {
    const values = new Set(this.nodes(ids).map(read));
    return values.size === 1 ? [...values][0] : undefined;
  }

  private elementPane(ids: string[]): HTMLElement[] {
    const { editor } = this,
      single = ids.length === 1,
      // A note is text attached to an element: it has no count, no copy and no interfaces.
      notes = this.nodes(ids).every((node) => node.kind === "note");
    return [
      this.elementSubject(ids),
      this.elementIdentity(ids, notes),
      this.group(
        "Style",
        this.row("Color", h("div", { class: "swatches" }, ...this.swatches(ids)), "div"),
        !notes && this.countRow(ids),
        single && this.copyRow(ids[0]),
      ),
      ...(single ? [this.geometry()] : []),
      this.group(
        "Arrange",
        this.arrangement(ids, "Align"),
        this.arrangement(ids, "Distribute"),
        this.arrangement(ids, "Size"),
        h("div", { class: "actions" }, this.layoutThese(single)),
      ),
      this.interfaces(ids),
      h(
        "div",
        { class: "actions end" },
        h(
          "button",
          { class: "button outlined", type: "button", onClick: () => editor.duplicateSelection() },
          "Duplicate",
        ),
        this.remove(),
      ),
    ];
  }

  /** What the element pane is about: one element, one note, or several elements. */
  private elementSubject(ids: string[]) {
    if (ids.length !== 1) return this.subject("shapes", `${ids.length} elements`);
    const [first] = this.nodes(ids);
    if (first?.kind === "note") return this.subject("uml-note", "Note");
    return this.subject((first?.kind as IconName) ?? "agent", "Element");
  }

  /** The name, kind and id of the selected elements: one alone has a name and an id to change. */
  private elementIdentity(ids: string[], notes: boolean) {
    const { editor } = this,
      [id] = ids,
      single = ids.length === 1;
    return this.group(
      "Identity",
      single &&
        this.row(
          notes ? "Text" : "Name",
          this.text(
            () => (this.nodes(ids)[0]?.label ?? "").replace(/<br\s*\/?>/gi, "\n"),
            (label) => editor.setElements({ label }),
            notes ? "Text" : "Name",
            true,
          ),
        ),
      this.row(
        "Kind",
        this.choice(
          ELEMENT_KINDS.map((kind) => ({ value: kind, name: kindName(kind) })),
          () => (this.shared(ids, (node) => node.kind) ?? "") as ElementKind | "",
          (kind) => editor.setElements({ kind }),
          // A design level kind stays on show for an element of it, and is offered to no other.
          (kind) => PLAIN_KINDS.has(kind) && editor.allowsElements({ kind }),
        ),
      ),
      // The id is what the source calls the element: changed in every connection that names it.
      single &&
        this.row(
          "Id",
          this.text(
            () => id,
            (next) => editor.renameElementId(id, next),
          ),
        ),
    );
  }

  /** A swatch for each color, and one for none, pressed at the color the selected elements share. */
  private swatches(ids: string[]) {
    const { editor } = this;
    return ["", ...COLORS].map((color) => {
      const name = color ? color[0].toUpperCase() + color.slice(1) : "No color";
      const swatch = h("button", {
        class: `swatch ${color || "none"}`,
        type: "button",
        ...tipped({ tip: name }),
        onClick: () => editor.setElements({ color: color || null }),
      });
      this.sync.push(() =>
        swatch.setAttribute(
          "aria-pressed",
          String((this.shared(ids, (node) => node.color ?? "") ?? "?") === color),
        ),
      );
      return swatch;
    });
  }

  /** How many an element stands for: one, a stack, or two with dots between. */
  private countRow(ids: string[]) {
    const { editor } = this,
      nodes = editor.doc.picture?.diagram.nodes,
      multiple = (node: TamNode) =>
        node.stack ? "stack" : nodes?.has(`${node.id}#2`) ? "several" : "one",
      change = (value: string) => ({ stack: value === "stack", multiple: value === "several" });
    return this.row(
      "Count",
      this.segments(
        [
          { value: "one", name: "One" },
          { value: "stack", name: "Stack", tip: "Several, drawn as a stack" },
          { value: "several", name: "A … B", tip: "Several, drawn as two with dots between" },
        ],
        () => this.shared(ids, multiple),
        (value) => editor.setElements(change(value)),
        (value) => editor.elementsRefusal(change(value)),
      ),
      "div",
    );
  }

  /** Shown as two with dots between, the copy stands beside or below; dragging it puts it anywhere. */
  private copyRow(id: string) {
    const { editor } = this,
      copyRow = this.row(
        "Copy",
        this.segments<"beside" | "below">(
          [
            { value: "beside", name: "Beside", tip: "A … B, side by side" },
            { value: "below", name: "Below", tip: "A … B, one above the other" },
          ],
          () => editor.copySide(id),
          (side) => editor.placeCopy(id, side),
        ),
        "div",
      );
    this.sync.push(() => {
      copyRow.hidden = !editor.doc.picture?.diagram.nodes.has(`${id}#2`);
    });
    return copyRow;
  }

  /** Where the element stands and how large it is, to the pixel. */
  private geometry() {
    return this.group(
      "Geometry",
      h(
        "div",
        { class: "numbers" },
        this.number("x", "X"),
        this.number("y", "Y"),
        this.number("width", "W"),
        this.number("height", "H"),
      ),
    );
  }

  /** A field of the geometry: one number of the selected element's box. */
  private number(name: "x" | "y" | "width" | "height", label: string) {
    const { editor } = this,
      field = this.text(
        () => {
          const box = editor.selectedBox;
          return box ? String(Math.round(box[name] * 10) / 10) : "";
        },
        (value) => {
          const next = Number(value);
          if (value.trim() && Number.isFinite(next)) editor.setBox({ [name]: next });
        },
      );
    field.setAttribute("inputmode", "decimal");
    field.setAttribute("aria-label", label);
    return h("label", { class: "number" }, h("span", {}, label), field);
  }

  /** Aligning and spreading need several elements; sizes can be made one, or left to the contents. */
  private arrangement(ids: string[], group: (typeof ARRANGE)[number]["group"]) {
    const { editor } = this;
    return this.row(
      group,
      h(
        "div",
        { class: "icons" },
        ...ARRANGE.filter((action) => action.group === group).map((action) => {
          const control = iconButton(
            action.icon,
            { tip: action.name },
            () => action.run(editor),
            "button small",
          );
          setOff(control, arrangeRefusal(action, ids.length));
          return control;
        }),
      ),
      "div",
    );
  }

  /** Only what is selected is laid out: the parts of a container, or several elements among themselves. */
  private layoutThese(single: boolean) {
    const { editor } = this,
      button = h(
        "button",
        { class: "button outlined", type: "button", onClick: () => void editor.layoutSelection() },
        icon("layout"),
        h("span", {}, single ? "Auto layout inside" : "Auto layout these"),
      );
    this.sync.push(() =>
      setOff(button, !editor.canLayoutSelection && "This element holds no others to lay out"),
    );
    return button;
  }

  /**
   * An interface is named, then added as one the element provides or requires. Interfaces belong
   * to the design level: only a diagram that has it already offers them, at elements that act.
   */
  private interfaces(ids: string[]) {
    const { editor } = this,
      [id] = ids;
    let offers: "provides" | "requires" = "provides";
    const name = h("input", {
      class: "field",
      type: "text",
      placeholder: "Name, for example IOrders",
      "aria-label": "Name of the interface",
      spellcheck: "false",
    });
    const add = () => {
      if (!name.value.trim()) return name.focus();
      editor.addInterface(id, offers, name.value);
      name.value = "";
    };
    name.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      add();
    });
    const interfaces = this.group(
      "Interfaces",
      name,
      h(
        "div",
        { class: "inline" },
        this.segments<"provides" | "requires">(
          [
            { value: "provides", name: "Provides" },
            { value: "requires", name: "Requires" },
          ],
          () => offers,
          (value) => {
            offers = value;
            this.update();
          },
        ),
        h("button", { class: "button outlined", type: "button", onClick: add }, "Add"),
      ),
    );
    this.sync.push(() => {
      interfaces.hidden = ids.length !== 1 || !editor.designLevel || !editor.allowsInterface(id);
    });
    return interfaces;
  }

  private wirePane(id: string): HTMLElement[] {
    if (!this.editor.connection(id)) return this.interfacePane();
    return [
      this.subject("connect", "Connection"),
      this.group(
        "Identity",
        this.row("Kind", this.wireKind(id)),
        ...this.wireEnds(id),
        this.bothWays(id),
      ),
      this.wireText(id),
      h("div", { class: "actions end" }, this.reverse(id), this.remove()),
    ];
  }

  /** The ids of the elements a connection joins. */
  private wireEnds(id: string) {
    const { editor } = this,
      from = h("code", { class: "id" }),
      to = h("code", { class: "id" });
    this.sync.push(() => {
      const connection = editor.connection(id);
      from.textContent = connection?.from ?? "";
      to.textContent = connection?.to ?? "";
    });
    return [this.row("From", from, "div"), this.row("To", to, "div")];
  }

  /** Whether a connection goes both ways, where it may. The line that attaches a note has no way. */
  private bothWays(id: string) {
    const { editor } = this,
      both = h("input", {
        type: "checkbox",
        onChange: () => editor.setWire(id, { both: both.checked }),
      }) as HTMLInputElement,
      row = h("label", { class: "row check" }, h("span", {}, "Both ways"), both);
    this.sync.push(() => {
      const connection = editor.connection(id);
      both.checked = !!connection?.both;
      row.hidden =
        connection?.word === "anchor" ||
        (!connection?.both && !editor.allowsWire(id, { both: true }));
    });
    return row;
  }

  /** Turns a connection the other way, where it may go so. */
  private reverse(id: string) {
    const { editor } = this,
      button = this.action("Reverse", () => editor.setWire(id, { reverse: true }));
    this.sync.push(() =>
      setOff(
        button,
        !editor.allowsWire(id, { reverse: true }) && "This connection only goes this way",
      ),
    );
    return button;
  }

  /**
   * What a connection says: its label, and the protocol of a channel. A dependency says its
   * keyword, and the line that attaches a note says nothing.
   */
  private wireText(id: string) {
    const { editor } = this,
      label = this.wireLabel(id),
      protocol = this.row(
        "Protocol",
        this.text(
          () => editor.connection(id)?.protocol ?? "",
          (text) => editor.setWire(id, { protocol: text }),
          "HTTPS, RFC, …",
        ),
      ),
      text = this.group("Text", label, protocol);
    this.sync.push(() => {
      const word = editor.connection(id)?.word ?? "";
      label.hidden = word === "dependency" || word === "anchor";
      text.hidden = word === "anchor";
      protocol.hidden = !CHANNELS.includes(word);
    });
    return text;
  }

  /** A provided or required interface, which the source names: it is only removed here. */
  private interfacePane(): HTMLElement[] {
    return [
      this.subject("link", "Interface"),
      h(
        "p",
        { class: "note" },
        "A provided or required interface of an element. Its name is set in the source.",
      ),
      h("div", { class: "actions end" }, this.remove()),
    ];
  }

  /** The label of a connection: what is sent or asked. A dependency's is its keyword, not shown here. */
  private wireLabel(id: string) {
    const { editor } = this;
    return this.row(
      "Label",
      this.text(
        () => {
          const connection = editor.connection(id);
          return (connection?.word === "dependency" ? "" : (connection?.label ?? "")).replace(
            /<br\s*\/?>/gi,
            "\n",
          );
        },
        (text) => editor.setWire(id, { label: text }),
        "What is sent or asked",
        true,
      ),
    );
  }

  /** The kind of a connection. A kind of the design level stays on show for a connection of it, and is offered to no other. */
  private wireKind(id: string) {
    const { editor } = this,
      kindOf = (value: string) => WIRES.find((item) => item.value === value)!;
    return this.choice(
      WIRES,
      () => {
        const connection = editor.connection(id);
        return connection ? wireValue(connection) : "";
      },
      (value) => editor.setWire(id, wireChange(kindOf(value))),
      (value) => !kindOf(value).design && editor.allowsWire(id, wireChange(kindOf(value))),
    );
  }

  /** Elements and connections selected together: only what both take. */
  private manyPane(): HTMLElement[] {
    const { editor } = this;
    return [
      this.subject("shapes", `${editor.selection.length} selected`),
      h(
        "p",
        { class: "note" },
        "Elements and connections are selected together. Select only elements, or one connection, to see properties.",
      ),
      h("div", { class: "actions end" }, this.remove()),
    ];
  }

  /** A part or a join of a diagram with a structure: its name or label, its kind, and its removal. */
  private flowPane(elements: string[], wires: string[]): HTMLElement[] {
    const { editor } = this;
    if (elements.length === 1 && !wires.length) return this.partPane(elements[0]);
    if (wires.length === 1 && !elements.length) return this.joinPane(wires[0]);
    if (editor.selection.length)
      return [
        this.subject("shapes", `${editor.selection.length} selected`),
        h("div", { class: "actions end" }, this.remove()),
      ];
    return [
      ...this.diagramPane(),
      h("p", { class: "note" }, `${typeInfo(editor.type).about}.`),
      h(
        "p",
        { class: "note" },
        "Click a shape on the left to add it, or drag it onto a part to join it there. Drag from a dot beside a part to connect. Double-click to name. The layout is automatic.",
      ),
    ];
  }

  /** A part of the structure on show. */
  private part(id: string) {
    return this.editor.doc.picture?.parts?.get(id);
  }

  /** One part of a diagram with a structure. */
  private partPane(id: string): HTMLElement[] {
    const { editor } = this,
      kind = this.part(id)?.kind ?? "",
      piece = editor.structure!.pieces.find((item) => item.kind === kind);
    const rows: (HTMLElement | false)[] = [
      this.subject(pieceIcon(kind), piece?.name ?? "Part"),
      this.partIdentity(id, kind),
      this.members(id),
      this.attributes(id, kind),
      h(
        "p",
        { class: "note" },
        "Click a shape on the left to add it at this one, or drag a dot beside it to another.",
      ),
      this.partActions(id),
    ];
    return rows.filter((row) => row !== false);
  }

  /** What is done to a part: a copy of one that is no group, the ungrouping of a group, its removal. */
  private partActions(id: string) {
    const { editor } = this,
      group = !!this.part(id)?.group;
    return h(
      "div",
      { class: "actions end" },
      editor.can("copy") && !group && this.action("Duplicate", () => editor.duplicateSelection()),
      editor.can("ungroup") && group && this.action("Ungroup", () => editor.ungroup(id)),
      this.remove(),
    );
  }

  /** The name and the id of a part, and what its type adds: a class's stereotype, what a state does. */
  private partIdentity(id: string, kind: string) {
    const { editor } = this;
    return this.group(
      "Identity",
      editor.nameable(id) &&
        this.row(
          "Name",
          this.text(
            () => (this.part(id)?.label ?? "").replace(/<br\s*\/?>/gi, "\n"),
            (label) => editor.relabel(id, label),
            "Name",
            true,
          ),
        ),
      this.partId(id),
      editor.type === "class" &&
        editor.members(id) !== undefined &&
        this.row(
          "Stereotype",
          this.text(
            () => classStereotype(editor.doc.source, id),
            (text) => editor.amend((source) => setClassStereotype(source, id, text)),
            "interface, abstract, …",
          ),
        ),
      editor.type === "state" &&
        kind === "state" &&
        this.row(
          "Does",
          this.text(
            () => stateDescription(editor.doc.source, id),
            (text) => editor.amend((source) => setStateDescription(source, id, text)),
            "entry / do something",
            true,
          ),
        ),
    );
  }

  /**
   * The id is what the source calls the part: changed at every mention where the type can. It
   * shows as the source writes it: the scene's has a prefix where a shape needs one.
   */
  private partId(id: string) {
    const { editor } = this,
      shown = id.replace(/^(head|ns):/, "");
    if (!editor.can("reid") || !editor.nameable(id))
      return this.row("Id", h("code", {}, shown), "div");
    return this.row(
      "Id",
      this.text(
        () => shown,
        (next) => editor.renameId(id, next),
      ),
    );
  }

  /** A class lists its attributes and methods, one a line. */
  private members(id: string) {
    const { editor } = this;
    if (editor.members(id) === undefined) return false;
    return this.group(
      "Members",
      this.text(
        () => (editor.members(id) ?? []).join("\n"),
        (text) => editor.setMembers(id, lines(text)),
        "+name: type\n+method()",
        true,
        true,
      ),
    );
  }

  /** An entity lists its attributes, one a line: a type, a name, keys and a comment. */
  private attributes(id: string, kind: string) {
    const { editor } = this;
    if (editor.type !== "er" || kind !== "entity") return false;
    return this.group(
      "Attributes",
      this.text(
        () => erAttributes(editor.doc.source, id).join("\n"),
        (text) => editor.amend((source) => setErAttributes(source, id, lines(text))),
        'int id PK\nstring name "a comment"',
        true,
        true,
      ),
    );
  }

  /** One join of a diagram with a structure. */
  private joinPane(id: string): HTMLElement[] {
    const { editor } = this,
      sequence = editor.type === "sequence";
    return [
      this.subject("connect", "Connection"),
      this.group(
        "Identity",
        this.linkKind(id),
        this.joinLabel(id),
        ...(editor.type === "class" ? this.multiplicities(id) : []),
        ...(editor.type === "er" ? this.cardinalities(id) : []),
      ),
      h(
        "div",
        { class: "actions end" },
        editor.can("reverse") && this.action("Reverse", () => editor.reverseJoin(id)),
        sequence &&
          this.action("Reply", () => editor.amend((source) => replyTo(source, id).source)),
        sequence &&
          this.action("Activation", () => editor.amend((source) => toggleActivation(source, id))),
        this.remove(),
      ),
    ];
  }

  /**
   * The kind of a join. A join of a kind that is only read has none to choose; a relationship
   * whose two cardinalities are no usual pair still takes one.
   */
  private linkKind(id: string) {
    const { editor } = this,
      { links } = editor.structure!,
      known = (kind: string | undefined) => links.some((link) => link.kind === kind);
    if (links.length < 2 || !(known(editor.linkKind(id)) || editor.type === "er")) return false;
    return this.row(
      "Kind",
      this.choice(
        links.map((link) => ({ value: link.kind, name: link.name })),
        () => {
          const kind = editor.linkKind(id) ?? "";
          return known(kind) ? kind : "";
        },
        (kind) => editor.relink(id, kind),
        () => true,
        "Other",
      ),
    );
  }

  /** The label of a join, where its kind has one. */
  private joinLabel(id: string) {
    const { editor } = this;
    if (!editor.wireLabel(id)) return false;
    return this.row(
      "Label",
      this.text(
        () => (editor.wireLabel(id)?.text ?? "").replace(/<br\s*\/?>/gi, "\n"),
        (label) => editor.wireLabel(id)?.set(label),
        "What it says",
        true,
      ),
    );
  }

  /** A diagram edited as text has its other properties in the source. */
  private textPane(): HTMLElement[] {
    const { editor } = this,
      info = typeInfo(editor.type);
    return [
      ...this.diagramPane(),
      h("p", { class: "note" }, `${info.about}.`),
      h(
        "p",
        { class: "note" },
        `${info.plural} are edited as text: type in the source or add a snippet from the left, and the picture follows.`,
      ),
    ];
  }

  /**
   * The properties of the whole diagram: its title, and those of the direction, the level and the
   * numbering of messages its type has.
   */
  private diagramPane(): HTMLElement[] {
    const { editor } = this,
      info = typeInfo(editor.type);
    return [
      editor.editable
        ? this.subject("logo", "Diagram")
        : this.subject(info.icon, "Diagram", info.name),
      this.group(
        "Identity",
        this.row(
          "Title",
          this.text(
            () => editor.header?.title ?? "",
            (title) => editor.setHeader({ title }),
            "Untitled",
          ),
        ),
      ),
      this.layoutGroup(),
      this.messagesGroup(),
    ].filter((item) => item !== false);
  }

  /** The direction and the level of the diagram, where its type has them. A level the diagram refuses is off and says why. */
  private layoutGroup(): HTMLElement | false {
    const { editor } = this,
      { settings } = editor,
      levels = LEVELS[editor.type] ?? LEVELS.tam!;
    if (!settings.direction && !settings.level) return false;
    return this.group(
      "Layout",
      settings.direction &&
        this.row(
          "Direction",
          this.segments<Direction>(
            [
              { value: "TB", icon: "arrow-down", tip: "Top to bottom" },
              { value: "LR", icon: "arrow-right", tip: "Left to right" },
            ],
            () => editor.header?.direction,
            (direction) => editor.setHeader({ direction }),
          ),
          "div",
        ),
      settings.level &&
        this.row(
          "Level",
          this.segments<"" | "conceptual" | "design">(
            [
              { value: "", name: "Any", tip: levels.any },
              { value: "conceptual", name: "Conceptual", tip: levels.conceptual },
              { value: "design", name: "Design", tip: levels.design },
            ],
            () => editor.header?.level ?? "",
            (level) => editor.setHeader({ level }),
            (level) => editor.headerRefusal({ level }),
          ),
          "div",
        ),
    );
  }

  /** Whether the messages of a sequence diagram are numbered. */
  private messagesGroup(): HTMLElement | false {
    const { editor } = this;
    if (!editor.settings.numbering) return false;
    const numbered = h("input", {
      type: "checkbox",
      onChange: () => editor.setHeader({ numbered: numbered.checked }),
    }) as HTMLInputElement;
    this.sync.push(() => {
      numbered.checked = !!editor.header?.numbered;
    });
    return this.group(
      "Messages",
      h(
        "label",
        { class: "row check", ...tipped({ tip: "Numbers the messages, from 1: `autonumber`" }) },
        h("span", {}, "Numbered"),
        numbered,
      ),
    );
  }
}
