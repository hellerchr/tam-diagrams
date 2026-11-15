/**
 * The Properties section of the right panel: what is selected, with its properties in groups that
 * keep their order (Identity, Style, Geometry, Arrange, Interfaces), or the diagram's own
 * properties when nothing is selected.
 */

import type { Direction } from "../src/elk.ts";
import { COLORS, ELEMENT_KINDS } from "../src/tam.ts";
import type { ElementKind } from "../src/tam-edit.ts";
import { h, icon, iconButton, setOff, tipped } from "./dom.ts";
import type { Editor } from "./editor.ts";
import type { IconName } from "./icons.ts";
import { ARRANGE, arrangeRefusal, WIRES, wireChange, wireValue } from "./menus.ts";
import { pieceIcon } from "./structures.ts";
import { kindName, typeInfo } from "./types.ts";

/** One of the buttons of a segmented control: a name or an icon, and what its tooltip says. */
interface Segment<T extends string> {
  value: T;
  name?: string;
  icon?: IconName;
  tip?: string;
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
    const { editor } = this,
      elements = editor.selectedElements,
      wires = editor.selectedWires;
    const key = [editor.type, ...editor.selection.map((part) => `${part.type}:${part.id}`)].join(
      " ",
    );
    if (key !== this.inspected || !this.element.childElementCount) {
      this.inspected = key;
      this.sync = [];
      this.element.replaceChildren(
        ...(editor.structural
          ? this.flowPane(elements, wires)
          : !editor.editable
            ? this.textPane()
            : wires.length === 1 && !elements.length
              ? this.wirePane(wires[0])
              : elements.length && !wires.length
                ? this.elementPane(elements)
                : editor.selection.length
                  ? this.manyPane()
                  : this.diagramPane()),
      );
    }
    for (const sync of this.sync) sync();
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
   * which Shift+Enter types.
   */
  private text(
    read: () => string,
    write: (value: string) => void,
    placeholder = "",
    multiline = false,
  ) {
    const field = multiline
      ? h("textarea", { class: "field", rows: "1", placeholder, spellcheck: "false" })
      : h("input", { class: "field", type: "text", placeholder, spellcheck: "false" });
    const fit = () => {
      if (multiline) field.setAttribute("rows", String(field.value.split("\n").length));
    };
    const commit = () => {
      if (field.value !== read()) write(field.value);
    };
    field.addEventListener("change", commit);
    field.addEventListener("input", fit);
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
      fit();
    });
    return field;
  }

  /** A list to choose one of; elements that differ show as mixed. */
  private choice<T extends string>(
    options: { value: T; name: string }[],
    read: () => T | "",
    write: (value: T) => void,
    allowed: (value: T) => boolean = () => true,
  ) {
    const items = options.map((option) => h("option", { value: option.value }, option.name)),
      mixed = h("option", { value: "", disabled: true }, "Mixed");
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
    // Where the element stands and how large it is, to the pixel.
    const number = (name: "x" | "y" | "width" | "height", label: string) => {
      const field = this.text(
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
    };
    // Aligning and spreading need several elements; sizes can be made one, or left to the contents.
    const arrangement = (group: (typeof ARRANGE)[number]["group"]) =>
      this.row(
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
    // Only what is selected is laid out: the parts of a container, or several elements among themselves.
    const layoutThese = h(
      "button",
      { class: "button outlined", type: "button", onClick: () => void editor.layoutSelection() },
      icon("layout"),
      h("span", {}, single ? "Auto layout inside" : "Auto layout these"),
    );
    this.sync.push(() =>
      setOff(layoutThese, !editor.canLayoutSelection && "This element holds no others to lay out"),
    );
    // Shown as two with dots between, the copy stands beside or below; dragging it puts it anywhere.
    const copyRow = this.row(
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
    // An interface is named, then added as one the element provides or requires.
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
    // Only elements that act offer interfaces.
    this.sync.push(() => {
      interfaces.hidden = !single || !editor.allowsInterface(id);
    });
    const first = nodes()[0];
    return [
      single
        ? this.subject((first?.kind as IconName) ?? "agent", "Element")
        : this.subject("shapes", `${ids.length} elements`),
      this.group(
        "Identity",
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
            ELEMENT_KINDS.map((kind) => ({ value: kind, name: kindName(kind) })),
            () => (shared((node) => node.kind) ?? "") as ElementKind | "",
            (kind) => editor.setElements({ kind }),
            (kind) => editor.allowsElements({ kind }),
          ),
        ),
        single && this.row("Id", h("code", { class: "id" }, id), "div"),
      ),
      this.group(
        "Style",
        this.row("Color", h("div", { class: "swatches" }, ...colors), "div"),
        this.row(
          "Count",
          this.segments(
            [
              { value: "one", name: "One" },
              { value: "stack", name: "Stack", tip: "Several, drawn as a stack" },
              { value: "several", name: "A … B", tip: "Several, drawn as two with dots between" },
            ],
            () => shared(multiple),
            (value) =>
              editor.setElements({ stack: value === "stack", multiple: value === "several" }),
            (value) =>
              editor.elementsRefusal({ stack: value === "stack", multiple: value === "several" }),
          ),
          "div",
        ),
        single && copyRow,
      ),
      ...(single
        ? [
            this.group(
              "Geometry",
              h(
                "div",
                { class: "numbers" },
                number("x", "X"),
                number("y", "Y"),
                number("width", "W"),
                number("height", "H"),
              ),
            ),
          ]
        : []),
      this.group(
        "Arrange",
        arrangement("Align"),
        arrangement("Distribute"),
        arrangement("Size"),
        h("div", { class: "actions" }, layoutThese),
      ),
      interfaces,
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

  private wirePane(id: string): HTMLElement[] {
    const { editor } = this,
      read = () => editor.connection(id);
    if (!read())
      return [
        this.subject("link", "Interface"),
        h(
          "p",
          { class: "note" },
          "An interface an element provides or requires. Its name is set in the source.",
        ),
        h("div", { class: "actions end" }, this.remove()),
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
    const from = h("code", { class: "id" }),
      to = h("code", { class: "id" });
    const reverse = h(
      "button",
      {
        class: "button outlined",
        type: "button",
        onClick: () => editor.setWire(id, { reverse: true }),
      },
      "Reverse",
    );
    this.sync.push(() => {
      const connection = read();
      both.checked = !!connection?.both;
      bothRow.hidden = !connection?.both && !editor.allowsWire(id, { both: true });
      setOff(
        reverse,
        !editor.allowsWire(id, { reverse: true }) && "This connection only goes this way",
      );
      label.hidden = connection?.word === "dependency";
      protocol.hidden = !channel();
      from.textContent = connection?.from ?? "";
      to.textContent = connection?.to ?? "";
    });
    return [
      this.subject("connect", "Connection"),
      this.group(
        "Identity",
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
            (value) =>
              editor.allowsWire(id, wireChange(WIRES.find((item) => item.value === value)!)),
          ),
        ),
        this.row("From", from, "div"),
        this.row("To", to, "div"),
        bothRow,
      ),
      this.group("Text", label, protocol),
      h("div", { class: "actions end" }, reverse, this.remove()),
    ];
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
    const { editor } = this,
      info = typeInfo(editor.type),
      structure = editor.structure!,
      parts = () => editor.doc.picture?.parts;
    if (elements.length === 1 && !wires.length) {
      const [id] = elements,
        kind = parts()?.get(id)?.kind ?? "",
        piece = structure.pieces.find((item) => item.kind === kind);
      const rows: (HTMLElement | false)[] = [
        this.subject(pieceIcon(kind), piece?.name ?? "Part"),
        this.group(
          "Identity",
          this.row(
            "Name",
            this.text(
              () => (parts()?.get(id)?.label ?? "").replace(/<br\s*\/?>/gi, "\n"),
              (label) => editor.relabel(id, label),
              "Name",
              true,
            ),
          ),
          this.row("Id", h("code", {}, id), "div"),
        ),
        // A class lists its attributes and methods, one a line.
        editor.members(id) !== undefined &&
          this.group(
            "Members",
            this.text(
              () => (editor.members(id) ?? []).join("\n"),
              (text) =>
                editor.setMembers(
                  id,
                  text
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
                ),
              "+name: type\n+method()",
              true,
            ),
          ),
        h(
          "p",
          { class: "note" },
          "Click a shape on the left to add it at this one, or drag a dot beside it to another.",
        ),
        h("div", { class: "actions end" }, this.remove()),
      ];
      return rows.filter((row) => row !== false);
    }
    if (wires.length === 1 && !elements.length) {
      const [id] = wires;
      return [
        this.subject("connect", "Connection"),
        this.group(
          "Identity",
          structure.links.length > 1 &&
            this.row(
              "Kind",
              this.choice(
                structure.links.map((link) => ({ value: link.kind, name: link.name })),
                () => editor.linkKind(id) ?? "",
                (kind) => editor.relink(id, kind),
              ),
            ),
          this.row(
            "Label",
            this.text(
              () => editor.wireLabel(id)?.text ?? "",
              (label) => editor.wireLabel(id)?.set(label),
              "What it says",
            ),
          ),
        ),
        h("div", { class: "actions end" }, this.remove()),
      ];
    }
    if (editor.selection.length)
      return [
        this.subject("shapes", `${editor.selection.length} selected`),
        h("div", { class: "actions end" }, this.remove()),
      ];
    return [
      this.subject(info.icon, info.name),
      h("p", { class: "note" }, `${info.about}.`),
      h(
        "p",
        { class: "note" },
        "Click a shape on the left to add it, or drag it onto a part to join it there. Drag from a dot beside a part to connect. Double-click to name. The layout is automatic.",
      ),
    ];
  }

  /** A diagram edited as text has its properties in the source. */
  private textPane(): HTMLElement[] {
    const { editor } = this,
      info = typeInfo(editor.type);
    return [
      this.subject(info.icon, info.name),
      h("p", { class: "note" }, `${info.about}.`),
      h(
        "p",
        { class: "note" },
        `${info.plural} are edited as text: type in the source or add a snippet from the left, and the picture follows.`,
      ),
    ];
  }

  private diagramPane(): HTMLElement[] {
    const { editor } = this,
      diagram = () => editor.doc.picture?.diagram;
    return [
      this.subject("logo", "Diagram"),
      this.group(
        "Identity",
        this.row(
          "Title",
          this.text(
            () => diagram()?.title ?? "",
            (title) => editor.setHeader({ title }),
            "Untitled",
          ),
        ),
      ),
      this.group(
        "Layout",
        this.row(
          "Direction",
          this.segments<Direction>(
            [
              { value: "TB", icon: "arrow-down", tip: "Top to bottom" },
              { value: "LR", icon: "arrow-right", tip: "Left to right" },
              { value: "BT", icon: "arrow-up", tip: "Bottom to top" },
              { value: "RL", icon: "arrow-left", tip: "Right to left" },
            ],
            () => diagram()?.direction,
            (direction) => editor.setHeader({ direction }),
          ),
          "div",
        ),
        this.row(
          "Level",
          this.segments<"" | "conceptual" | "design">(
            [
              { value: "", name: "Any", tip: "Agents and components side by side" },
              {
                value: "conceptual",
                name: "Conceptual",
                tip: "Agents, storages and channels only",
              },
              { value: "design", name: "Design", tip: "Components, interfaces and connectors" },
            ],
            () => diagram()?.level ?? "",
            (level) => editor.setHeader({ level }),
            (level) => editor.headerRefusal({ level }),
          ),
          "div",
        ),
      ),
    ];
  }
}
