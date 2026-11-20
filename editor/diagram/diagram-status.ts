// What the diagram editor's status bar (DiagramStatus.svelte) says, as tam-diagrams' editor said it (statusbar.ts): the
// hint for what the pointer can do now, what is selected, and whether the diagram is placed by hand.

/** What the hint depends on. */
export type HintState = {
  /** The source does not read; `picture`: the last picture that did shows. */
  problem: boolean;
  picture: boolean;
  /** A UML diagram edited on the canvas (it lays itself out), and a block diagram (placed by hand). */
  structural: boolean;
  editable: boolean;
  /** The diagram's type in plural ("Class diagrams"). */
  plural: string;
  /** The gesture under way, if any. */
  doing?: string;
  tool: string;
  /** A shape tool that stays on after a placing. */
  sticky?: boolean;
  elements: number;
  wires: number;
};

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

/** `n` things, in the plural unless one. */
export const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** What is selected: "2 elements, 1 connection"; empty for nothing. */
export const selectionText = (elements: number, wires: number) =>
  [elements && count(elements, "element"), wires && count(wires, "connection")]
    .filter(Boolean)
    .join(", ");

/** The hint of the select tool, for what is selected. */
function selectionHint({ elements, wires }: HintState): string {
  if (elements + wires > 1)
    return "Drag to move them together · align and distribute from the Arrange menu · right-click for more";
  if (elements)
    return "Drag to move · drag a dot to connect · double-click to rename · right-click for more";
  if (wires)
    return "Drag an end to another element · double-click to label · right-click to change its kind";
  return "Drag a shape onto the canvas · double-click it for an agent · drag a frame to select · right-click for more";
}

/** The hint in a block diagram: for the gesture under way, the tool, or what is selected. */
function canvasHint(state: HintState): string {
  const doing = state.doing && GESTURE_HINTS[state.doing];
  if (doing) return doing;
  if (state.tool === "select") return selectionHint(state);
  return (
    TOOL_HINTS[state.tool] ??
    (state.sticky
      ? "Click to place an element · again for another · Escape to stop"
      : "Click to place the element · inside another element to put it there · Shift-click to place several")
  );
}

/** The hint for the state the editor is in. */
export function hintText(state: HintState): string {
  if (state.problem)
    return state.picture
      ? "The source has an error: the diagram shows as it last was"
      : "The source has an error: the diagram shows once it is mended";
  if (state.structural)
    return state.elements === 1
      ? "Click a shape to add it here · drag a dot to connect · double-click to rename · Delete removes"
      : "Click a shape to add it, or drag it onto a part · drag a dot to connect · the layout is automatic";
  if (!state.editable)
    return `${state.plural} are edited as text: type in the source or add a snippet · drag to move the view · Ctrl + wheel zooms`;
  return canvasHint(state);
}

/** The layout mode's tooltip: placed by hand (`structural`: a UML diagram's marks), or automatic. */
export const modeTip = (placed: boolean, structural: boolean) =>
  placed
    ? `Parts stand where the source places them (${structural ? "%% @id x,y" : "@x,y"}). Click for Auto layout.`
    : "No element is placed: the layout is automatic until one is moved.";

/** Parses a zoom typed in percent ("150", "150%", "1,5e2"); undefined when it is no zoom. */
export function typedZoom(text: string): number | undefined {
  const percent = Number.parseFloat(text.replace(",", "."));
  return percent > 0 ? percent / 100 : undefined;
}
