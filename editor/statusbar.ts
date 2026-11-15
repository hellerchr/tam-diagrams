/**
 * The status bar: a hint for what the pointer can do now, the problems of the source, what is
 * selected, where the pointer is in the diagram, how the diagram is laid out, snapping and the zoom.
 */

import type { Point } from "../src/scene.ts";
import { h, icon, iconButton, tipped } from "./dom.ts";
import type { Editor } from "./editor.ts";
import { menuButton, type MenuEntry } from "./menu.ts";
import { typeInfo } from "./types.ts";

/** What the status bar asks of the panels around it. */
export interface StatusHost {
  /** The Arrange menu, which the layout mode opens. */
  arrange(): MenuEntry[];
  /** The zoom steps and fits. */
  zoom(): MenuEntry[];
  /** Shows where the problem is: the line of an error, or the elements that overlap. */
  showProblem(): void;
  toggleSnap(): void;
}

/** What the pointer does with each tool. */
const TOOL_HINTS: Record<string, string> = {
  pan: "Drag to move the view · Ctrl + wheel zooms",
  connect: "Drag from one element to another",
};

/** What a gesture under way can still do. */
const GESTURE_HINTS: Record<string, string> = {
  move: "Drop into a container to put it inside · Shift keeps to one axis · Ctrl drags a copy · Alt moves freely",
  resize: "Edges line up with other elements · Alt resizes freely",
  connect: "Release on an element to connect · on the empty canvas for a new agent",
  attach: "Release on the element the connection should end at",
  frame: "Elements inside the frame are selected",
  place: "Release to place the element",
};

const count = (number: number, one: string) => `${number} ${one}${number === 1 ? "" : "s"}`;

export class StatusBar {
  readonly element: HTMLElement;
  private readonly editor: Editor;
  private readonly hint = h("div", { class: "hint" });
  private readonly problem: HTMLButtonElement;
  private readonly selection = h("span", { class: "status-item" });
  private readonly pointer = h("span", { class: "status-item position" });
  private readonly mode: HTMLButtonElement;
  private readonly snap: HTMLButtonElement;
  private readonly zoom: HTMLButtonElement;
  private readonly zoomText = h("span", {});

  constructor(editor: Editor, host: StatusHost) {
    this.editor = editor;
    this.problem = h(
      "button",
      { class: "status-button problem-item", type: "button", onClick: () => host.showProblem() },
      icon("warning"),
      h("span", {}),
    );
    this.mode = h("button", { class: "status-button", type: "button" }, h("span", {}));
    menuButton(this.mode, () => host.arrange(), { above: true });
    this.snap = h(
      "button",
      {
        class: "status-button toggle",
        type: "button",
        ...tipped({
          tip: "Snap to the grid and to other elements. Alt turns it off while dragging.",
          side: "top",
        }),
        onClick: () => host.toggleSnap(),
      },
      icon("snap"),
      h("span", {}, "Snap"),
    );
    this.zoom = h(
      "button",
      { class: "status-button zoom", type: "button", ...tipped({ tip: "Zoom", side: "top" }) },
      this.zoomText,
      icon("chevron"),
    );
    menuButton(this.zoom, () => host.zoom(), { above: true, right: true });
    this.element = h(
      "footer",
      { class: "status" },
      this.hint,
      this.problem,
      this.selection,
      this.pointer,
      this.mode,
      this.snap,
      h(
        "div",
        { class: "zooms" },
        iconButton(
          "minus",
          { tip: "Zoom out", key: "−", side: "top" },
          () => editor.view.zoomBy(0.8),
          "status-button",
        ),
        this.zoom,
        iconButton(
          "plus",
          { tip: "Zoom in", key: "+", side: "top" },
          () => editor.view.zoomBy(1.25),
          "status-button",
        ),
      ),
    );
    this.showZoom();
    this.showPointer(undefined);
  }

  showZoom() {
    this.zoomText.textContent = `${Math.round(this.editor.view.zoom * 100)}%`;
  }

  /** Shows where the pointer is in the diagram's coordinates; nothing while it is off the canvas. */
  showPointer(point: Point | undefined) {
    this.pointer.textContent = point ? `${Math.round(point.x)}, ${Math.round(point.y)}` : "";
  }

  /** The hint for the state the editor is in. */
  private hintText(): string {
    const { editor } = this,
      { doc } = editor,
      elements = editor.selectedElements.length,
      wires = editor.selectedWires.length;
    if (doc.problem) return "The source has an error: the diagram shows as it last was";
    if (editor.structural)
      return elements === 1
        ? "Click a shape to add it after this node · drag a dot to connect · double-click to rename · Delete removes"
        : "Click a shape to add it · select a node first to continue from it · the layout is automatic";
    if (!editor.editable)
      return `${typeInfo(editor.type).plural} are edited as text: type in the source or add a snippet · drag to move the view · Ctrl + wheel zooms`;
    if (editor.doing && GESTURE_HINTS[editor.doing]) return GESTURE_HINTS[editor.doing];
    if (editor.tool !== "select")
      return (
        TOOL_HINTS[editor.tool] ??
        (editor.sticky
          ? "Click to place an element · again for another · Escape to stop"
          : "Click to place the element · inside another element to put it there · Shift-click to place several")
      );
    if (elements + wires > 1)
      return "Drag to move them together · align and distribute from the Arrange menu · right-click for more";
    if (elements)
      return "Drag to move · drag a dot to connect · double-click to rename · right-click for more";
    if (wires)
      return "Drag an end to another element · double-click to label · right-click to change its kind";
    return "Drag a shape onto the canvas · double-click it for an agent · drag a frame to select · right-click for more";
  }

  /** Shows the editor's state: called whenever it changed. */
  update() {
    const { editor } = this,
      { doc } = editor,
      elements = editor.selectedElements.length,
      wires = editor.selectedWires.length;
    this.hint.textContent = this.hintText();
    const overlaps = doc.picture?.overlaps.length ?? 0,
      label = this.problem.lastElementChild!;
    this.problem.hidden = !doc.problem && !overlaps;
    this.problem.classList.toggle("warning", !doc.problem);
    label.textContent = doc.problem ? "1 problem" : `TAM: ${count(overlaps, "overlap")}`;
    this.problem.dataset.tip = doc.problem
      ? doc.problem.message.replace(/`/g, "")
      : "Elements lie on each other. TAM places all elements apart.";
    this.problem.dataset.side = "top";
    this.selection.textContent = [
      elements && count(elements, "element"),
      wires && count(wires, "connection"),
    ]
      .filter(Boolean)
      .join(", ");
    this.selection.hidden = !elements && !wires;
    const placed = !!doc.picture?.placed && doc.picture.diagram.nodes.size > 0;
    this.mode.hidden = this.snap.hidden = !editor.editable;
    this.mode.firstElementChild!.textContent = placed ? "Manual positions" : "Auto layout";
    this.mode.dataset.tip = placed
      ? "Elements stand where the source places them (@x,y). Arrange has Auto layout."
      : "No element is placed: the layout is automatic until one is moved.";
    this.mode.dataset.side = "top";
    this.snap.setAttribute("aria-pressed", String(editor.snapping));
  }
}
