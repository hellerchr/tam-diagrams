/**
 * The editor: selection, tools and gestures on the canvas, and the commands the panels and the
 * keyboard run. Every change goes through the document as a new source.
 */

import type { DiagramColors } from "../src/draw.ts";
import { around, type Box, contains, inside, overlaps, type Point } from "../src/scene.ts";
import {
  type Connection,
  ELEMENT_KINDS,
  parseTam,
  type Placement,
  type TamDiagram,
  type TamEdge,
  type TamNode,
  type Word,
} from "../src/tam.ts";
import {
  idFor,
  isGeneratedId,
  renameId,
  addElement,
  addInterface,
  connect,
  connectionOf,
  copyOf,
  type ConnectionChange,
  duplicate,
  type ElementChange,
  type ElementKind,
  holder,
  moveInto,
  paste,
  place,
  placeLabel,
  remove,
  setConnection,
  setElement,
  setHeader,
  unplace,
  unwrap,
  wrap,
} from "../src/tam-edit.ts";
import { declaredElements } from "../src/tam-pin.ts";
import type { Doc, Picture } from "./document.ts";
import {
  boxesOf,
  boxOf,
  dropTarget,
  elementOf,
  elementShapes,
  elementsIn,
  type Part,
  partAt,
  samePart,
  wireOf,
  wireParts,
} from "./hit.ts";
import { type Arrangement, arrange, type Guide, guidesAt, snapEdge, snapMove } from "./guides.ts";
import {
  ALIGN,
  frameOf,
  type Gesture,
  type GestureOf,
  guidesOf,
  HANDLE,
  type Handle,
  laneBorderAt,
  type LaneBorder,
  movedPast,
  type Pointed,
  showsPreview,
  REACH,
  SLOP,
} from "./gesture.ts";
import { dropPlace, GRID, NAMES, roomAt, shifted, sizeOf, snap, takenBoxes } from "./placing.ts";
import { parseUml } from "../src/index.ts";
import type { Piece, Structure, StructureEdge, StructureNode } from "../src/structure.ts";
import { classMembers, setClassMembers } from "../src/uml-class-edit.ts";
import { moveMessage, moveParticipant } from "../src/uml-sequence-edit.ts";
import { labelGroups, labelKey, labelOffset } from "../src/label-places.ts";
import { textGroupBox } from "../src/text.ts";
import { laneFrame, placeable } from "../src/uml-placed.ts";
import {
  followPlaces,
  hasMarks,
  hasPlaces,
  readLabels,
  readPlaces,
  setLabel,
  setLane,
  setPlaces,
  unmarked,
} from "../src/uml-places.ts";
import {
  setUmlHeader,
  turnPlaces,
  type UmlHeader,
  umlHeader,
  type UmlHeaderChange,
  umlSettings,
  withTitle,
} from "../src/uml-header-edit.ts";
import { structureOf } from "./structures.ts";
import { type DiagramType, typeInfo, typeOf } from "./types.ts";
import { COMMAND_KEYS, isTyping, keysElsewhere, PLAIN_KEYS } from "./keys.ts";
import {
  drawAttach,
  drawConnect,
  drawFrame,
  drawGhost,
  drawGuides,
  drawHandles,
  drawHover,
  drawLabelDrag,
  drawLinkDots,
  drawOverlaps,
  drawSelection,
  drawTarget,
  drawWireEnds,
  handlePoints,
  linkPoints,
  Pen,
} from "./overlay.ts";
import type { View } from "./view.ts";

/** An element in the tree of the diagram. */
export interface TreeItem {
  id: string;
  kind: ElementKind;
  label: string;
  children: TreeItem[];
}

/** What the pointer does on the canvas: select and move, pan, draw a connection, or place an element of a kind. */
export type Tool = "select" | "pan" | "connect" | ElementKind;

/** A change of the header of a block diagram: its title, direction and level. */
type TamHeader = Parameters<typeof setHeader>[1];
/** A change of the settings of a whole diagram, of any type. */
type HeaderChange = TamHeader & UmlHeaderChange;

/** Whether a kind of piece is of a family, by the word in its name. */
const kindIs = (kind: string, word: string) => kind.toLowerCase().includes(word);

export class Editor {
  readonly doc: Doc;
  readonly view: View;
  colors: DiagramColors;
  /** The accent color of selections and handles. */
  accent = "#2a78d6";
  selection: Part[] = [];
  tool: Tool = "select";
  /** Whether a shape tool stays after it placed an element, to place several; Escape ends it. */
  sticky = false;
  /** Called when the selection, the tool or the document changed: the panels show them. */
  onState: () => void = () => {};
  /** Says something to the user in passing: why an edit was not made. */
  notify: (message: string) => void = () => {};
  /** Called when the pointer moved over the canvas, with its place in the diagram, and when it left. */
  onPointer: (point: Point | undefined) => void = () => {};
  /** Opens a text field over the canvas; the panels provide it. */
  editText: (
    box: Box,
    text: string,
    options: { size: number; weight: number },
    done: (text: string | undefined) => void,
  ) => void = () => {};
  private gesture: Gesture | undefined;
  /** Why the header may not change in ways asked lately, while the source is the one they were asked of. */
  private refusals: { source: string; reasons: Map<string, string | undefined> } = {
    source: "",
    reasons: new Map(),
  };
  /** The header of the source last read. */
  private headerRead: { source: string; header?: UmlHeader } = { source: "" };
  /** The kind of join picked for new connections. */
  private picked: string | undefined;
  /** The part just added that has no name of its own yet. */
  private fresh: string | undefined;
  /** The kind of piece being dragged from the palette. */
  private dragged: string | undefined;
  /** The part a piece dragged from the palette would join. */
  private pieceTarget: string | undefined;
  private hover: Part | undefined;
  /** The element whose connection dots show: the one under the pointer, until the pointer leaves the dots. */
  private linkHost: string | undefined;
  /** A new element shown before it is placed: under the pointer with a shape tool, or dragged from the palette. */
  private ghost: { kind: ElementKind; at: Point; target: string | null } | undefined;
  private space = false;
  /** Where the pointer was at the last paste. */
  private pasted: Point | undefined;
  /** What was copied last, and how often it was pasted. */
  private copied: { text: string; times: number } | undefined;
  /** Whether the pointer is on the canvas. */
  private over = false;
  private pointer: Point = { x: 0, y: 0 };
  /** Whether the diagram on show is one edited as text: the tool follows when that changes. */
  private textOnly = false;

  constructor(doc: Doc, view: View, colors: DiagramColors) {
    this.doc = doc;
    this.view = view;
    this.colors = colors;
    view.overlay = (context) => this.drawOverlay(context);
    this.listenToPointer(view.canvas);
    this.listenToClipboard();
    window.addEventListener("keydown", (event) => this.key(event));
    window.addEventListener("keyup", (event) => {
      if (event.key === " ") {
        this.space = false;
        this.cursor();
      }
    });
  }

  /** Takes the presses, moves and wheel of the pointer on the canvas. */
  private listenToPointer(canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerdown", (event) => this.down(event));
    canvas.addEventListener("pointermove", (event) => this.move(event));
    canvas.addEventListener("pointerup", (event) => this.up(event));
    canvas.addEventListener("pointercancel", () => this.abort());
    canvas.addEventListener("dblclick", (event) => this.doubleClick(event));
    canvas.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerenter", () => (this.over = true));
    canvas.addEventListener("pointerleave", () => this.leave());
  }

  /** The pointer left the canvas: what it was over shows no longer, and its dots take no click. */
  private leave() {
    this.over = false;
    if (!this.gesture) {
      this.hover = undefined;
      this.linkHost = undefined;
      this.ghost = undefined;
      this.view.invalidate();
    }
    this.onPointer(undefined);
  }

  /** Copy, cut and paste work on the selection unless a text field has the focus. */
  private listenToClipboard() {
    const copy = (event: ClipboardEvent, cut: boolean) => {
      if (isTyping(event.target)) return;
      const text = this.copy();
      if (text === undefined) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
      if (cut) this.deleteSelection();
    };
    document.addEventListener("copy", (event) => copy(event, false));
    document.addEventListener("cut", (event) => copy(event, true));
    document.addEventListener("paste", (event) => {
      if (isTyping(event.target)) return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      this.paste(text);
    });
  }

  private get picture() {
    return this.doc.picture;
  }

  /** The picture changed: selections of what is gone go with it. */
  refresh() {
    const { picture } = this;
    this.followTextOnly();
    if (picture && !this.gesture && picture.source === this.doc.source)
      this.selection = this.selection.filter((part) => shows(picture.diagram, part));
    void this.view.show(
      this.doc.svg(this.colors),
      picture?.scene.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
    );
    this.view.invalidate();
    this.onState();
  }

  /** A picture edited as text is moved about; one edited on the canvas starts with the select tool. */
  private followTextOnly() {
    if ((this.editable || this.structural) !== this.textOnly) return;
    this.textOnly = !this.editable && !this.structural;
    this.tool = this.textOnly ? "pan" : "select";
    this.sticky = false;
    this.ghost = undefined;
    this.cursor();
  }

  // Selection.

  select(parts: Part[]) {
    this.selection = parts;
    // The dots of what the pointer was over before go: they come back when it moves there.
    this.linkHost = undefined;
    this.view.invalidate();
    this.onState();
  }

  isSelected(part: Part) {
    return this.selection.some((other) => samePart(other, part));
  }

  get selectedElements(): string[] {
    return this.selection.filter((part) => part.type === "element").map((part) => part.id);
  }

  get selectedWires(): string[] {
    return this.selection.filter((part) => part.type === "wire").map((part) => part.id);
  }

  /** Picks the tool. A diagram edited as text is only moved about; a sticky shape tool places several. */
  setTool(tool: Tool, sticky = false) {
    if (
      !this.editable &&
      tool !== "pan" &&
      !(this.structural && (tool === "select" || tool === "connect"))
    )
      return;
    this.tool = tool;
    this.sticky = sticky && !!shapeOf(tool);
    this.ghost = undefined;
    this.view.invalidate();
    this.cursor();
    this.onState();
  }

  // Commands. Each makes one change to the source; a change the notation forbids is said, not made.

  /** Applies a new source; false, with a notice, when it breaks a rule of the notation. */
  private change(source: string | undefined, run?: string): boolean {
    if (source === undefined) {
      const { problem } = this.doc;
      this.notify(
        problem
          ? `Fix the error in the source first${problem.line ? ` (line ${problem.line})` : ""}.`
          : this.structural
            ? `This is not available for ${typeInfo(this.type).plural.toLowerCase()} yet.`
            : !this.editable
              ? `${typeInfo(this.type).plural} are edited as text, in the source.`
              : "The layout is not ready yet.",
      );
      return false;
    }
    const problem = this.doc.tryApply(source, run);
    if (problem) this.notify(problem.message.replace(/^Line \d+: /, ""));
    return !problem;
  }

  /** What the document draws: a source without a picture yet says it by its first line. */
  get type(): DiagramType {
    return typeOf(this.doc.source);
  }

  /** The structure of the diagram, when its parts are edited on the canvas by one. */
  get structure(): Structure | undefined {
    return structureOf(this.type);
  }

  /**
   * Whether the diagram's structure is edited on the canvas: its parts are added, named, joined
   * and removed by edits of its `Structure`, and moved by places (`%% @id x,y`) at the end of the
   * source. Without places its layout is automatic.
   */
  get structural(): boolean {
    return !!this.structure;
  }

  /** An edit of a structure's source: applied when the result still reads as a diagram of its type. */
  private structEdit(
    make: (structure: Structure, source: string) => string,
    run?: string,
  ): boolean {
    const { structure } = this;
    if (this.doc.problem || !structure) return this.change(undefined);
    if (this.picture?.source !== this.doc.source) {
      this.notify("The layout is not ready yet.");
      return false;
    }
    try {
      // The places follow the parts: a part given another id keeps its place, one that is gone leaves none.
      const made = make(structure, this.doc.source),
        next = hasMarks(made) ? followPlaces(structure.read, this.doc.source, made) : made;
      parseUml(next);
      void this.doc.apply(next, run);
      return true;
    } catch (reason) {
      this.notify(reasonOf(reason));
      return false;
    }
  }

  /**
   * Adds a piece to a diagram with a structure, at a part: inside it when it is a group, else
   * joined to it as the piece joins (a step follows, a start leads) and in its group. Without `at`
   * the one selected part is taken; with null the piece stands alone; `joined` joins it to the part
   * whatever the piece says, as a connection drawn to the empty canvas asks. In a diagram whose
   * parts are placed it stands around `spot`. Its name opens for typing.
   */
  addPiece(kind: string, at?: string | null, lane?: string, joined = false, spot?: Point) {
    const { picture, structure } = this,
      piece = structure?.pieces.find((item) => item.kind === kind);
    if (!structure || !piece || !picture) return;
    const refused = this.pieceRefusal(kind);
    if (refused) return this.notify(`${refused}.`);
    const node = this.pieceAt(picture, at),
      stand = standing(piece, node, { lane, joined, sequence: this.type === "sequence" }),
      made = this.addedPiece(piece, stand.parent, stand.joins ? node : undefined, spot);
    if (made === undefined) return;
    // Some pieces exist only at another: the start of a state machine at the state it leads to.
    if (!made) {
      this.notify(`${piece.name} stands at another part: select one first, or drop it onto one.`);
      return;
    }
    this.welcome(made, !!piece.named);
  }

  /**
   * Adds a piece in a group, joined to `node` when given: the id it got, empty when nothing was
   * added, undefined when the edit was not made.
   */
  private addedPiece(
    piece: Piece,
    parent: string | null,
    node: StructureNode | undefined,
    spot: Point | undefined,
  ): string | undefined {
    let made = "";
    const before = this.doc.source;
    const done = this.structEdit((edits, source) => {
      const added = edits.add(source, { kind: piece.kind, parent });
      made = added.id;
      return joinedPiece(edits, added, piece, node, spot);
    });
    if (!done) return undefined;
    return this.doc.source === before ? "" : made;
  }

  /** The part a piece is added at: the one asked for, else the one selected part; none with null. */
  private pieceAt(picture: Picture, at: string | null | undefined): StructureNode | undefined {
    const [only] = this.selectedElements,
      chosen =
        at === null ? undefined : (at ?? (this.selectedElements.length === 1 ? only : undefined));
    return chosen ? picture.parts?.get(chosen) : undefined;
  }

  /** A piece just added is selected and shown, and its name opens for typing when it has one. */
  private welcome(made: string, named: boolean) {
    this.tool = "select";
    this.pieceTarget = undefined;
    // The first name typed for it may become its id.
    this.fresh = named ? made : undefined;
    this.select([{ type: "element", id: made }]);
    void this.whenShown().then(() => {
      // A piece that exists only as the end of a join may have come out under another id.
      if (!this.picture?.parts?.has(made)) return this.select([]);
      this.reveal(made);
      if (named) this.rename(made);
    });
  }

  /**
   * Why a piece cannot be added to the diagram as it stands, as its structure says: a group to an
   * activity diagram with lanes. Undefined when it can, or while the source has an error.
   */
  pieceRefusal(kind: string): string | undefined {
    return this.doc.problem ? undefined : this.structure?.refusal?.(this.doc.source, kind);
  }

  /** A piece dragged from the palette is over a point of the canvas: the part it would join shows. */
  showPieceTarget(at: Point | undefined, kind?: string) {
    this.dragged = at ? (kind ?? this.dragged) : undefined;
    const found = at && this.elementAt(at),
      node = this.partOf(found),
      piece = this.draggedPiece;
    // Only a part the piece would stand in, or be joined to, shows as its target.
    const target = node && piece && this.takesPiece(node, piece) ? found : undefined;
    if (target === this.pieceTarget) return;
    this.pieceTarget = target;
    this.view.invalidate();
  }

  /** A part of a structure by its id. */
  private partOf(id: string | undefined): StructureNode | undefined {
    return id ? this.picture?.parts?.get(id) : undefined;
  }

  /** The piece being dragged from the palette. */
  private get draggedPiece(): Piece | undefined {
    return this.structure?.pieces.find((item) => item.kind === this.dragged);
  }

  /** The element right under a point of the picture. */
  private elementAt(point: Point): string | undefined {
    const part = this.picture ? partAt(this.picture, point, 0) : undefined;
    return part?.type === "element" ? part.id : undefined;
  }

  /** Whether a part takes a piece dropped onto it: it stands in the part, or is joined to it. */
  private takesPiece(node: StructureNode, piece: Piece): boolean {
    return (
      !piece.group &&
      (node.group || kindIs(piece.kind, "note") || this.type === "sequence" || joinsTo(piece, node))
    );
  }

  /** A piece dropped on the canvas: at the part under it, or alone on the empty canvas. */
  dropPiece(kind: string, at: Point) {
    this.addPiece(kind, this.targetAt(at) ?? null, this.laneAt(at), false, at);
  }

  /**
   * The element a connection or a dropped piece is aimed at: the one under the point, and in a
   * sequence diagram the participant whose lifeline runs there.
   */
  private targetAt(point: Point): string | undefined {
    const { picture } = this;
    if (!picture) return undefined;
    const part = partAt(picture, point, 0);
    if (part?.type === "element") return part.id;
    return this.type === "sequence" ? lifelineAt(picture, point) : undefined;
  }

  /**
   * The lane of a swimlane diagram a point lies in. Lanes are drawn as lines, not shapes: the lane
   * is the one whose parts lie nearest across the lanes.
   */
  private laneAt(point: Point): string | undefined {
    const { picture } = this;
    if (this.type !== "swimlane" || !picture?.parts) return undefined;
    const lanes = laneBoxes(picture);
    if (!lanes.length) return undefined;
    // Lanes lie side by side along the axis their middles differ most on.
    const middles = lanes.map(({ box }) => ({
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      })),
      spread = (axis: "x" | "y") =>
        Math.max(...middles.map((middle) => middle[axis])) -
        Math.min(...middles.map((middle) => middle[axis])),
      axis = spread("x") >= spread("y") ? "x" : "y";
    return lanes
      .map((lane, index) => ({ id: lane.id, away: Math.abs(middles[index][axis] - point[axis]) }))
      .toSorted((a, b) => a.away - b.away)[0].id;
  }

  /** Whether anything of the picture lies at a point: a shape or a text, also one that is no part. */
  private drawnAt(point: Point): boolean {
    const { picture } = this;
    return (
      !!picture &&
      (picture.scene.shapes.some(
        (shape) => shape.kind !== "region" && contains(shape.box, point),
      ) ||
        picture.scene.texts.some((text) => contains(text.box, point)))
    );
  }

  /** Gives an element another name, in whichever notation the diagram is written. */
  relabel(id: string, label: string) {
    const first = this.fresh === id;
    this.fresh = undefined;
    if (this.structural) this.relabelPart(id, label, first);
    else this.relabelElement(id, label, first);
  }

  /** Names an element of a block diagram. A new one takes its id from its first name: `Order API` is `order_api`. */
  private relabelElement(id: string, label: string, first: boolean) {
    const named = first && isGeneratedId(id) && !!label.trim();
    let next = id;
    const done = this.edit((source) => {
      const labelled = setElement(source, id, { label });
      if (!named) return labelled;
      next = idFor(labelled, label);
      const renamed = renameId(labelled, id, next);
      if (renamed === labelled) next = id;
      return renamed;
    });
    if (done && next !== id) this.select([{ type: "element", id: next }]);
  }

  /** Names a part of a structure. A part just added takes its id from its first name where the syntax allows. */
  private relabelPart(id: string, label: string, first: boolean) {
    let named = id;
    const done = this.structEdit((edits, source) => {
      if (!first || !edits.retitle) return edits.rename(source, id, label);
      const result = edits.retitle(source, id, label);
      named = result.id || id;
      return result.source;
    });
    if (done && named !== id && this.isSelected({ type: "element", id }))
      this.select(
        this.selection.map((part) =>
          part.type === "element" && part.id === id ? { type: "element", id: named } : part,
        ),
      );
  }

  /** The label of a connection, and a way to set it; undefined for one that carries none. */
  wireLabel(id: string): { text: string; set: (text: string) => void } | undefined {
    if (this.structural) return this.joinLabel(id);
    const connection = this.connection(id);
    return connection && connection.word !== "dependency"
      ? { text: connection.label ?? "", set: (text) => this.setWire(id, { label: text }) }
      : undefined;
  }

  /** The label of a join of a structure; a join whose text says what kind it is has no label to set. */
  private joinLabel(id: string): { text: string; set: (text: string) => void } | undefined {
    const edge = this.picture?.joins?.get(id);
    if (!edge || edge.fixedLabel) return undefined;
    return {
      text: edge.label ?? "",
      set: (text) => void this.structEdit((edits, source) => edits.label(source, id, text)),
    };
  }

  /** The attributes and methods of a class of a class diagram, one a line; undefined for anything else. */
  members(id: string): string[] | undefined {
    const kind = this.picture?.parts?.get(id)?.kind;
    if (this.type !== "class" || !kind || kind === "note" || kind === "package") return undefined;
    try {
      return classMembers(this.doc.source, id);
    } catch {
      return undefined;
    }
  }

  /** Replaces the attributes and methods of a class. */
  setMembers(id: string, members: string[]) {
    this.structEdit((_, source) => setClassMembers(source, id, members));
  }

  /**
   * The kind of join new connections are drawn with. In a structure the usual one until another is
   * picked; in a block diagram the one picked in the palette, or none for the word that fits the
   * two elements.
   */
  get link(): string | undefined {
    if (!this.structure)
      return typeInfo(this.type).links?.some((item) => item.kind === this.picked)
        ? this.picked
        : undefined;
    const links = this.structure.links;
    return links.some((item) => item.kind === this.picked) ? this.picked : links[0]?.kind;
  }

  /**
   * Picks the kind of join new connections are drawn with. In a block diagram the kind is a tool: a
   * drag from element to element draws it, and picking it again goes back to the word that fits.
   * A selected connection keeps its kind: the next one drawn would else change the one before.
   */
  setLink(kind: string) {
    if (this.structure) {
      this.picked = kind;
      this.onState();
      return;
    }
    if (!typeInfo(this.type).links?.some((item) => item.kind === kind)) return;
    const again = this.picked === kind;
    this.picked = again ? undefined : kind;
    this.setTool(again ? "select" : "connect");
  }

  /** What a connection of a block diagram says when drawn now: the kind picked, or the word that fits. */
  private get linkChange(): { word: Word; both: boolean; label: undefined } | undefined {
    const shape = typeInfo(this.type).links?.find((item) => item.kind === this.link);
    return shape && { word: shape.word, both: !!shape.both, label: undefined };
  }

  /** Gives an element of a block diagram another id, in every connection and interface that names it. */
  renameElementId(id: string, next: string) {
    const to = next.trim();
    const done = this.edit((source) => {
      const renamed = renameId(source, id, to);
      if (renamed === source) throw new Error(`\`${to}\` is taken, or is no id.`);
      return renamed;
    });
    if (done) this.select([{ type: "element", id: to }]);
  }

  /** Whether the diagram's structure has one of the edits that not every type has. */
  can(edit: "reverse" | "copy" | "moveInto" | "ungroup" | "reid"): boolean {
    return !!this.structure?.[edit];
  }

  /** Swaps the ends of a join of a structure. */
  reverseJoin(id: string) {
    this.structEdit((edits, source) => {
      const next = edits.reverse?.(source, id) ?? source;
      if (next === source) throw new Error("This connection has only one way to run.");
      return next;
    });
  }

  /** Removes a group of a structure and keeps what it holds. */
  ungroup(id: string) {
    if (this.structEdit((edits, source) => edits.ungroup?.(source, id) ?? source)) this.select([]);
  }

  /** Gives a part of a structure another id, at every mention of it. */
  renameId(id: string, next: string) {
    const structure = this.structure;
    if (!structure?.reid) return;
    let named = "";
    const done = this.structEdit((edits, source) => {
      const result = edits.reid!(source, id, next.trim());
      if (result === source) throw new Error(`\`${next.trim()}\` is taken, or is no id.`);
      // The part is the one that was not there before.
      const before = new Set(edits.read(source).nodes.map((node) => node.id));
      named = edits.read(result).nodes.find((node) => !before.has(node.id))?.id ?? "";
      return result;
    });
    if (done && named) this.select([{ type: "element", id: named }]);
  }

  /** Runs an edit of a structure's source that only its type has: a class's stereotype, a state's description. */
  amend(make: (source: string) => string) {
    this.structEdit((_, source) => make(source));
  }

  /** Whether a part of a structure carries a name to type: a start or a fork does not. */
  nameable(id: string): boolean {
    const kind = this.picture?.parts?.get(id)?.kind,
      piece = this.structure?.pieces.find((item) => item.kind === kind);
    return !this.structural || !piece || !!piece.named;
  }

  /**
   * Moves the selected message of a sequence diagram a step earlier or later, or the selected
   * participant a column to the left or right.
   */
  shift(delta: -1 | 1) {
    if (this.type !== "sequence" || this.selection.length !== 1) return;
    const [part] = this.selection;
    // Where the participants are placed, their places order them: one moves along its row.
    if (part.type === "element" && hasPlaces(this.doc.source)) return this.nudge(delta * GRID, 0);
    this.structEdit((_, source) =>
      part.type === "wire"
        ? moveMessage(source, part.id, delta)
        : moveParticipant(source, part.id, delta),
    );
  }

  /** The kind of a join of a structure, one of its links. */
  linkKind(id: string): string | undefined {
    return this.picture?.joins?.get(id)?.kind;
  }

  /** Makes a join of a structure one of another kind. */
  relink(id: string, kind: string) {
    this.structEdit((edits, source) => edits.relink(source, id, kind));
  }

  /** Whether the diagram is edited on the canvas; the UML types are edited as text. */
  get editable(): boolean {
    return this.type === "tam";
  }

  /** Adds a piece of source at the end: the statements a text diagram is built from. */
  insert(text: string) {
    void this.doc.apply(`${this.doc.source.trimEnd()}\n${text}\n`);
  }

  /** Runs an edit of the committed source, which must parse. */
  private edit(make: (source: string) => string): boolean {
    if (this.doc.problem || !this.editable) return this.change(undefined);
    try {
      return this.change(make(this.doc.source));
    } catch (reason) {
      this.notify(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }

  /** Whether an edit leaves a source the notation allows: the panels offer only such choices. */
  private allows(make: (source: string) => string): boolean {
    return this.refusal(make) === undefined;
  }

  /** Why an edit is not allowed, in the words of the notation's rule; undefined when it is. */
  private refusal(make: (source: string) => string): string | undefined {
    if (!this.editable) return `${typeInfo(this.type).plural} are edited as text.`;
    if (this.doc.problem) return "The source has an error.";
    try {
      parseTam(make(this.doc.source));
      return undefined;
    } catch (reason) {
      return reasonOf(reason);
    }
  }

  /** Why the diagram's header may not change this way; undefined when it may. */
  headerRefusal(header: HeaderChange): string | undefined {
    if (this.editable) return this.refusal((source) => setHeader(source, header as TamHeader));
    if (this.doc.problem) return "The source has an error.";
    const { source } = this.doc,
      key = JSON.stringify(header);
    // The panels ask again at every change of state: the answers hold while the source does.
    if (this.refusals.source !== source) this.refusals = { source, reasons: new Map() };
    if (!this.refusals.reasons.has(key)) {
      let reason: string | undefined;
      try {
        setUmlHeader(source, header);
      } catch (error) {
        reason = reasonOf(error);
      }
      this.refusals.reasons.set(key, reason);
    }
    return this.refusals.reasons.get(key);
  }

  /** What the source says of the whole diagram: its title, direction, level and the like. */
  get header(): UmlHeader | undefined {
    if (this.editable) {
      const diagram = this.picture?.diagram;
      return (
        diagram && { title: diagram.title, direction: diagram.direction, level: diagram.level }
      );
    }
    const { source } = this.doc;
    if (this.headerRead.source !== source) {
      let header: UmlHeader | undefined;
      try {
        header = umlHeader(source);
      } catch {
        // While the source has an error the fields keep what they showed.
      }
      this.headerRead = { source, header };
    }
    return this.headerRead.header;
  }

  /** The settings of the whole diagram its type has besides the title, which every type has. */
  get settings(): { direction: boolean; level: boolean; numbering: boolean } {
    const type = this.type;
    // Block diagrams are drawn at the conceptual level only: the editor offers no level to choose.
    if (type === "tam") return { direction: true, level: false, numbering: false };
    const settings = umlSettings(type);
    return { ...settings, direction: !!settings.direction };
  }

  /** Why the selected elements may not change this way; undefined when they may. */
  elementsRefusal(change: ElementChange) {
    const ids = this.selectedElements;
    return this.refusal((source) => ids.reduce((next, id) => setElement(next, id, change), source));
  }

  /** Whether a connection drawn from an element may reach another; each answer is kept for the gesture. */
  private reaches(gesture: GestureOf<"connect">, target: string): boolean {
    gesture.reaches ??= new Map();
    let fits = gesture.reaches.get(target);
    if (fits === undefined) {
      fits = this.connectRefusal(gesture.from, target) === undefined;
      gesture.reaches.set(target, fits);
    }
    return fits;
  }

  /** Why two elements may not be connected with the kind of connection picked; undefined when they may. */
  private connectRefusal(from: string, to: string): string | undefined {
    return this.refusal((source) => connect(source, from, to, this.linkChange));
  }

  /** Whether a connection may change this way, between the elements it joins. */
  allowsWire(id: string, change: ConnectionChange) {
    return this.allows((source) => setConnection(source, id, change));
  }

  /** Whether the selected elements may change this way, where they stand and with their connections. */
  allowsElements(change: ElementChange) {
    const ids = this.selectedElements;
    return this.allows((source) => ids.reduce((next, id) => setElement(next, id, change), source));
  }

  /** The elements of the diagram as a tree: what each holds, in the order of the source. */
  get tree(): TreeItem[] {
    const { picture } = this;
    if (!picture) return [];
    const { diagram } = picture;
    const items = (ids: string[]): TreeItem[] =>
      ids.flatMap((id) => {
        const node = diagram.nodes.get(id)!;
        if (id.endsWith("#row")) return items(node.children);
        if (!(ELEMENT_KINDS as readonly string[]).includes(node.kind)) return [];
        if (node.origin && node.origin !== id) return [];
        return [
          { id, kind: node.kind as ElementKind, label: node.label, children: items(node.children) },
        ];
      });
    return items(diagram.roots);
  }

  /** Whether elements may stand inside another, or at the top with null. */
  allowsMove(ids: string[], parent: string | null) {
    if (this.structure) return this.partsMayMove(this.structure, ids, parent);
    return (
      !ids.includes(parent ?? "") &&
      this.allows((source) => {
        const moved = moveInto(source, ids, parent);
        if (moved === source) throw new Error("Nothing moves.");
        return moved;
      })
    );
  }

  /** Whether parts of a structure may stand in a group, or at the top with null. */
  private partsMayMove(structure: Structure, ids: string[], parent: string | null) {
    return (
      !!structure.moveInto &&
      !ids.includes(parent ?? "") &&
      (parent === null || !!this.picture?.parts?.get(parent)?.group)
    );
  }

  /** Puts elements inside another, or at the top with null: below what stands there, so nothing lies on anything. */
  moveElements(ids: string[], parent: string | null) {
    if (this.structural) return this.moveParts(ids, parent);
    const base = this.doc.placedSource();
    if (base === undefined) return this.change(undefined);
    try {
      const picture = this.doc.layout(base),
        // What stands in the target already stays where it is.
        outer = moversOf(picture.diagram, ids).outer.filter(
          (id) => holder(picture.diagram, id) !== parent,
        ),
        into = parent ? boxOf(picture, parent) : picture.scene.bounds;
      if (!outer.length) return;
      const source = into ? rowBelow(base, picture, outer, into) : base;
      if (this.change(moveInto(source, outer, parent)))
        this.select(outer.map((id) => ({ type: "element", id })));
    } catch (reason) {
      this.notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  /** Puts parts of a structure into a group, or out of every group with null. */
  private moveParts(ids: string[], parent: string | null) {
    const done = this.structEdit((edits, source) => {
      const moved = ids.reduce((next, id) => edits.moveInto?.(next, id, parent) ?? next, source);
      if (moved === source) throw new Error("This part cannot stand there.");
      return moved;
    });
    if (done) this.select(ids.map((id) => ({ type: "element", id })));
  }

  /** Brings an element into view when it is outside it. */
  reveal(id: string) {
    const { picture, view } = this,
      box = picture && boxOf(picture, id);
    if (box) view.reveal(box);
  }

  /** Whether elements snap to the grid and to each other; Alt turns it off for one gesture. */
  snapping = true;

  private free(event: { altKey: boolean }) {
    return event.altKey || !this.snapping;
  }

  /** The outermost selected elements with their boxes, in a placed picture of the source: what arranging works on. */
  private units() {
    const base = this.doc.placedSource();
    if (base === undefined) return undefined;
    const picture = this.doc.layout(base),
      { outer } = moversOf(picture.diagram, this.selectedElements);
    const boxes = new Map(
      outer.flatMap((id) => {
        const box = boxOf(picture, id);
        return box ? [[id, box] as [string, Box]] : [];
      }),
    );
    return { base, picture, boxes };
  }

  /**
   * What moving parts of a structure starts from: the source with every part placed where it
   * stands, the outermost of the parts, the places of the shapes that move with them, and every
   * part among them. Undefined, with a notice, while there is no picture of the source.
   */
  private partMovers(ids: string[]) {
    const { picture } = this,
      pinned = this.structural ? this.doc.pinnedSource() : undefined;
    if (!picture || pinned === undefined) {
      this.notify(
        this.doc.problem ? "Fix the error in the source first." : "The layout is not ready yet.",
      );
      return undefined;
    }
    return { picture, pinned, ...partsMoving(picture, ids) };
  }

  /** Applies a source that only places parts of a structure differently. */
  private placeParts(source: string, run?: string) {
    try {
      parseUml(source);
    } catch (reason) {
      return this.notify(reason instanceof Error ? reason.message : String(reason));
    }
    void this.doc.apply(source, run);
  }

  /** Aligns the selected elements on a side or middle of the box around them, or spreads them with even gaps. */
  arrange(how: Arrangement) {
    if (this.structural) return this.arrangeParts(how);
    const units = this.units();
    if (!units) return void this.change(undefined);
    let source = units.base;
    for (const [id, step] of arrange(units.boxes, how))
      source = place(source, shifted(moversOf(units.picture.diagram, [id]).places, step.x, step.y));
    this.change(source);
  }

  /** Arranges the selected parts of a structure; the participants of a sequence diagram keep their row. */
  private arrangeParts(how: Arrangement) {
    const moving = this.partMovers(this.selectedElements);
    if (!moving) return;
    const units = partUnits(moving.picture, moving.outer),
      places = new Map<string, Point>();
    for (const [id, step] of arrange(new Map([...units].map(([id, unit]) => [id, unit.box])), how))
      for (const shape of units.get(id)!.shapes) {
        const at = moving.places.get(shape)!;
        places.set(shape, {
          x: at.x + step.x,
          y: this.type === "sequence" ? at.y : at.y + step.y,
        });
      }
    if (places.size) this.placeParts(setPlaces(moving.pinned, places));
  }

  /** Makes the selected elements as wide, or as high, as the largest of them. */
  sameSize(side: "width" | "height") {
    if (this.structural) return this.notify("The parts of this diagram size themselves.");
    const units = this.units();
    if (!units) return void this.change(undefined);
    const most = Math.max(...[...units.boxes.values()].map((box) => box[side]));
    this.change(
      place(
        units.base,
        new Map(
          [...units.boxes].map(([id, box]) => [
            id,
            { x: box.x, y: box.y, width: box.width, height: box.height, [side]: most },
          ]),
        ),
      ),
    );
  }

  /** Lets the selected containers fit their parts, and leaves take the size of their names. */
  fitSize() {
    if (this.structural) return this.notify("The parts of this diagram size themselves.");
    const units = this.units();
    if (!units) return void this.change(undefined);
    this.change(
      place(
        units.base,
        new Map(
          [...units.boxes].map(([id, box]) => [
            id,
            units.picture.diagram.nodes.get(id)!.children.length
              ? undefined
              : { x: box.x, y: box.y },
          ]),
        ),
      ),
    );
  }

  /** Where the copy of an element shown as several stands, when it is beside or below its original. */
  copySide(id: string): "beside" | "below" | undefined {
    const { picture } = this,
      box = picture && boxOf(picture, id),
      copy = picture && boxOf(picture, `${id}#2`);
    if (!box || !copy) return undefined;
    if (Math.abs(copy.y - box.y) < 1 && copy.x > box.x) return "beside";
    if (Math.abs(copy.x - box.x) < 1 && copy.y > box.y) return "below";
    return undefined;
  }

  /** Stands the copy of an element shown as several beside or below its original. */
  placeCopy(id: string, side: "beside" | "below") {
    const base = this.doc.placedSource();
    if (base === undefined) return void this.change(undefined);
    const box = boxOf(this.doc.layout(base), id);
    if (!box) return;
    // Without a place of its own a copy stands across the diagram's direction: beside in one that
    // runs down, below in one that runs across. The other side needs a place.
    const direction = this.picture?.diagram.direction ?? "TB",
      usual = direction === "TB" || direction === "BT" ? "beside" : "below",
      gap = 3 * GRID,
      at =
        side === usual
          ? undefined
          : side === "beside"
            ? { x: box.x + box.width + gap, y: box.y }
            : { x: box.x, y: box.y + box.height + gap };
    this.change(place(base, new Map([[`${id}#2`, at]])));
  }

  /** Whether an element may provide or require an interface. */
  allowsInterface(id: string) {
    return this.allows((source) => addInterface(source, id, "provides", "I"));
  }

  deleteSelection() {
    if (!this.selection.length) return;
    const ids = this.selection.map((part) => part.id);
    const done = this.structural
      ? this.structEdit((edits, source) => edits.remove(source, ids))
      : this.edit((source) => remove(source, ids));
    if (done) this.select([]);
  }

  duplicateSelection() {
    const ids = this.selectedElements;
    if (!ids.length) return;
    if (this.structural) return this.duplicateParts(ids);
    const offset = this.copyOffset(ids);
    let made: string[] = [];
    const done = this.edit((source) => {
      const result = duplicate(source, ids, offset);
      made = result.ids;
      return result.source;
    });
    if (done) this.select(made.map((id) => ({ type: "element", id })));
  }

  /** How far copies of elements stand from their originals: beside them, a gap away, further down while something stands there. */
  private copyOffset(ids: string[]): Point {
    const { picture } = this,
      boxes = picture?.placed ? ids.flatMap((id) => boxesOf(picture, id)) : [];
    if (!picture || !boxes.length) return { x: 2 * GRID, y: 2 * GRID };
    const all = around(boxes);
    return roomAt(
      { x: snap(all.width + 2 * GRID, false), y: 0 },
      (offset) => ({ x: offset.x, y: offset.y + 2 * GRID }),
      (offset) => ({ ...all, x: all.x + offset.x, y: all.y + offset.y }),
      takenBoxes(picture),
    );
  }

  /**
   * Copies parts of a structure. Each copy stands for itself, without the joins of its original:
   * where the parts are placed beside its original, further down while something stands there;
   * else where the layout puts it.
   */
  private duplicateParts(ids: string[]) {
    let made: string[] = [];
    const { picture } = this;
    const done = this.structEdit((edits, source) => {
      if (!edits.copy) throw new Error("Parts of this diagram are not copied yet.");
      // Where the parts are placed, each copy stands beside its original.
      const copies = copyParts(edits.copy, source, ids, hasPlaces(source) ? picture : undefined);
      made = copies.made;
      return copies.source;
    });
    if (done) this.select(made.map((id) => ({ type: "element", id })));
  }

  /** The selected elements as text, with the connections among them: what copying puts on the clipboard. */
  copy(): string | undefined {
    const ids = this.selectedElements;
    if (!ids.length || this.doc.problem) return undefined;
    if (this.structural) {
      this.notify("Parts of this diagram are not copied between diagrams yet: Ctrl+D duplicates.");
      return undefined;
    }
    try {
      this.copied = { text: copyOf(this.doc.source, ids), times: 0 };
      return this.copied.text;
    } catch {
      return undefined;
    }
  }

  /** Adds copied elements: under the pointer when it is on the canvas, else a step beside their originals. */
  paste(text: string) {
    const fragment = this.pastedFragment(text);
    if (!fragment) return;
    const placed = !!this.picture?.placed,
      base = placed ? this.doc.placedSource() : this.doc.source;
    if (base === undefined) return void this.change(undefined);
    this.countPaste(fragment);
    const picture = placed ? this.doc.layout(base) : undefined,
      pasted = parseTam(fragment),
      aimed = this.aimedPaste(),
      at = this.pasteSpot(picture, pasted, aimed),
      into = this.pasteHolder(picture, pasted, aimed);
    const result = paste(base, fragment, { at, placed }),
      made = result.ids;
    const done = this.change(
      into ? (movedInto(result.source, made, into) ?? result.source) : result.source,
    );
    if (done) this.select(made.map((id) => ({ type: "element", id })));
  }

  /** Counts a paste of what was copied last; other text counts from one. */
  private countPaste(fragment: string) {
    if (this.copied?.text !== fragment) this.copied = { text: fragment, times: 0 };
    this.copied.times++;
  }

  /** The text on the clipboard when it holds elements; says so when it holds something else. */
  private pastedFragment(text: string): string | undefined {
    const fragment = text.replace(/\r\n?/g, "\n").trim();
    try {
      return fragment && parseTam(fragment).nodes.size ? fragment : undefined;
    } catch {
      this.notify("The clipboard holds no elements.");
      return undefined;
    }
  }

  /**
   * Whether a paste lands under the pointer: when it is on the canvas and has moved since the
   * last paste. Else it lands beside the copies before, so that no paste lands on another.
   */
  private aimedPaste(): boolean {
    const { pasted, pointer } = this,
      aimed = this.over && (pasted?.x !== pointer.x || pasted?.y !== pointer.y);
    this.pasted = { ...pointer };
    return aimed;
  }

  /** Where pasted elements stand: under the pointer or a step beside where they were copied, then on until they are clear of others. */
  private pasteSpot(picture: Picture | undefined, pasted: TamDiagram, aimed: boolean): Point {
    const places = [...pasted.nodes.values()].flatMap((node) => (node.at ? [node.at] : []));
    const origin = places.length
      ? { x: Math.min(...places.map((at) => at.x)), y: Math.min(...places.map((at) => at.y)) }
      : this.pointer;
    const at = aimed
      ? { x: snap(this.pointer.x, false), y: snap(this.pointer.y, false) }
      : { x: origin.x + 2 * GRID, y: origin.y + 2 * GRID };
    if (!picture || !places.length) return at;
    const size = {
      width: Math.max(...places.map((item) => item.x + (item.width ?? 96))) - origin.x,
      height: Math.max(...places.map((item) => item.y + (item.height ?? 40))) - origin.y,
    };
    return roomAt(
      at,
      (spot) => ({ x: spot.x + 2 * GRID, y: spot.y + 2 * GRID }),
      (spot) => ({ ...spot, ...size }),
      takenBoxes(picture),
    );
  }

  /**
   * The container pasted elements go into: the one the paste lands in, as a shape dropped there
   * would go. Not aimed, they go beside what was copied, in the same container.
   */
  private pasteHolder(
    picture: Picture | undefined,
    pasted: TamDiagram,
    aimed: boolean,
  ): string | null {
    if (!picture) return null;
    if (aimed) return dropTarget(picture, this.pointer, new Set(), false);
    const original = [...pasted.nodes.keys()].find((id) => picture.diagram.nodes.has(id));
    return original ? holder(picture.diagram, original) : null;
  }

  /** Whether the selected elements may stand together in a new element of a kind. */
  allowsWrap(kind: ElementKind) {
    const ids = this.selectedElements;
    return (
      ids.length > 0 && this.allows((source) => wrap(source, ids, { kind, label: "x" }).source)
    );
  }

  /** Puts the selected elements in a new element that holds them, and opens its name. */
  wrapSelection(kind: ElementKind) {
    const ids = this.selectedElements;
    if (!ids.length) return;
    let made = "";
    const done = this.edit((source) => {
      const result = wrap(source, ids, { kind, label: NAMES[kind] || undefined });
      made = result.id;
      return result.source;
    });
    if (!done) return;
    this.select([{ type: "element", id: made }]);
    if (kind !== "group") void this.whenShown().then(() => this.rename(made));
  }

  /**
   * Why the selection takes no new group: it is one group, or the very parts of one, which are
   * grouped already. Undefined when it may be grouped.
   */
  get groupedAlready(): string | undefined {
    const { picture } = this,
      ids = this.selectedElements;
    if (!picture || !ids.length) return undefined;
    const { diagram } = picture;
    if (ids.length === 1 && diagram.nodes.get(ids[0])?.kind === "group")
      return "This is a group already";
    const around = this.selectionHolder;
    return around && holdsOnly(diagram, around, ids.length)
      ? "These are grouped already"
      : undefined;
  }

  /** Ctrl+G: the selected elements of a block diagram go in a new group, unless they are grouped already. */
  groupSelection() {
    if (!this.editable) return;
    const already = this.groupedAlready;
    if (already) return this.notify(`${already}.`);
    this.wrapSelection("group");
  }

  /** The one selected part that holds others and can be taken apart, if there is one. */
  get ungroupable(): string | undefined {
    const [only] = this.selectedElements,
      { picture } = this;
    if (!only || this.selectedElements.length !== 1 || !picture) return undefined;
    const holds = this.editable
      ? holdsAny(picture.diagram, only)
      : this.can("ungroup") && !!picture.parts?.get(only)?.group;
    return holds ? only : undefined;
  }

  /** Ctrl+Shift+G: the selected box goes, and what it held stays where it stood. */
  ungroupSelection() {
    const id = this.ungroupable;
    if (!id) return;
    if (!this.editable) return this.ungroup(id);
    if (this.edit((source) => unwrap(source, id))) this.select([]);
  }

  /** The element that holds all selected elements, when one does. */
  get selectionHolder(): string | null {
    const { picture } = this,
      ids = this.selectedElements;
    if (!picture || !ids.length) return null;
    const holders = new Set(ids.map((id) => holder(picture.diagram, id)));
    return holders.size === 1 ? [...holders][0] : null;
  }

  /** Takes the selected elements out of the element that holds them, into the one around it. */
  takeOut() {
    const { picture } = this,
      inside = this.selectionHolder,
      base = this.doc.placedSource();
    if (!picture || !inside) return;
    if (base === undefined) return void this.change(undefined);
    const ids = this.selectedElements,
      outer = holder(picture.diagram, inside);
    this.edit(() => {
      const moved = moveInto(base, ids, outer),
        diagram = parseTam(moved),
        box = diagram.nodes.get(inside);
      // A box that holds nothing any more and is joined to nothing was only there to hold them.
      const idle =
        !!box &&
        !box.children.length &&
        !diagram.edges.some((edge) => edge.source === inside || edge.target === inside);
      return idle ? remove(moved, [inside]) : moved;
    });
  }

  /** Resolves when the picture of the committed source is on show. */
  private async whenShown() {
    for (let tries = 0; tries < 200 && this.picture?.source !== this.doc.source; tries++)
      await new Promise((resolve) => setTimeout(resolve, 25));
  }

  /** What was copied last here, for a paste the browser's clipboard does not serve. */
  get copiedText() {
    return this.copied?.text;
  }

  /** What a right click asks for; the panels show the menu. */
  onMenu: (at: { x: number; y: number }, point: Point) => void = () => {};

  selectAll() {
    const { picture } = this;
    if (!picture) return;
    this.select(
      declaredElements(picture.diagram).map((node) => ({ type: "element", id: node.id })),
    );
  }

  setElements(change: ElementChange) {
    const ids = this.selectedElements;
    if (this.structural) {
      if (change.label !== undefined && ids.length === 1) this.relabel(ids[0], change.label);
      return;
    }
    this.edit((source) => ids.reduce((next, id) => setElement(next, id, change), source));
  }

  setWire(id: string, change: ConnectionChange) {
    this.edit((source) => setConnection(source, id, change));
  }

  addInterface(id: string, offers: "provides" | "requires", name: string) {
    this.edit((source) => addInterface(source, id, offers, name));
  }

  /**
   * Changes the settings of the whole diagram, as one edit. A UML diagram whose parts are placed
   * turns their places with its direction, so the picture turns as the automatic layout would.
   */
  setHeader(header: HeaderChange) {
    if (this.editable) {
      this.edit((source) => setHeader(source, header as TamHeader));
      return;
    }
    const turned = (source: string) => withUmlHeader(source, header, this.picture);
    if (this.structural) this.structEdit((_, source) => turned(source));
    else if (this.doc.problem) this.change(undefined);
    else
      try {
        void this.doc.apply(turned(this.doc.source));
      } catch (reason) {
        this.notify(reasonOf(reason));
      }
  }

  /**
   * Gives the diagram another title, in the way its type writes one. A UML source with an error
   * takes it in its frontmatter all the same.
   */
  setTitle(title: string) {
    if (this.editable || !this.doc.problem) this.setHeader({ title: title.trim() });
    else void this.doc.apply(withTitle(this.doc.source, title));
  }

  /**
   * Whether a block diagram has design level parts already: it says `level design`, or declares
   * components, subsystems, classes, packages or interfaces, or joins by delegation or a «use» or
   * «import» dependency. The editor offers plain block diagrams; such a diagram keeps what it has
   * on offer, such as its interfaces.
   */
  get designLevel(): boolean {
    const diagram = this.picture?.diagram;
    if (!this.editable || !diagram) return false;
    return (
      diagram.level === "design" ||
      [...diagram.nodes.values()].some(isDesignNode) ||
      diagram.edges.some(isDesignEdge)
    );
  }

  /** Whether the diagram takes elements of a kind: a conceptual one takes no components. */
  allowsKind(kind: ElementKind) {
    return this.allows((source) => addElement(source, { kind, label: "x" }).source);
  }

  /** The connection behind a selected wire; undefined for an interface's line. */
  connection(id: string): Connection | undefined {
    try {
      return this.doc.problem ? undefined : connectionOf(this.doc.source, id);
    } catch {
      return undefined;
    }
  }

  /** Clears every placement: the layout is automatic again. */
  async autoLayout() {
    if (this.structural) {
      if (this.doc.problem) return void this.change(undefined);
      if (!hasMarks(this.doc.source)) return;
      void this.doc.apply(unmarked(this.doc.source));
      await this.fitSoon();
      return;
    }
    if (this.edit(unplace)) await this.fitSoon();
  }

  /** Whether the selection can be laid out on its own: one element that holds others, or several elements. */
  get canLayoutSelection(): boolean {
    const { picture } = this,
      ids = this.selectedElements;
    if (!picture || !this.editable) return false;
    return (
      ids.length > 1 || (ids.length === 1 && !!picture.diagram.nodes.get(ids[0])?.children.length)
    );
  }

  /**
   * Lays out only what is selected: the parts of the one selected container, or the selected
   * elements among themselves. Everything else stays where it is.
   */
  async layoutSelection() {
    const base = this.doc.placedSource(),
      ids = this.selectedElements;
    if (base === undefined) return void this.change(undefined);
    try {
      const next = await this.doc.layoutWithin(base, ids);
      // The document may have moved on while the layout ran.
      if (this.doc.placedSource() !== base && this.doc.source !== base) return;
      this.change(next);
    } catch (reason) {
      this.notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  /** Fits the picture once the layout under way is shown. */
  async fitSoon() {
    // A source with an error gets no picture to wait for.
    for (
      let tries = 0;
      tries < 200 && !this.doc.problem && this.picture?.source !== this.doc.source;
      tries++
    )
      await new Promise((resolve) => setTimeout(resolve, 25));
    // The page may still be finding its size.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    this.fit();
  }

  /** Opens the list of shortcuts; the panels show it. */
  onHelp: () => void = () => {};

  /** Shows the selected elements as large as the canvas allows. */
  fitSelection() {
    const { picture } = this,
      boxes = picture ? this.selectedElements.flatMap((id) => boxesOf(picture, id)) : [];
    if (boxes.length) this.view.fit(around(boxes), 120);
    else this.fit();
  }

  /** Where the one selected element stands and how large it is drawn. */
  get selectedBox(): Box | undefined {
    return this.single?.box;
  }

  /** Stands the one selected element at a position, or gives it a size. */
  setBox(change: Partial<Box>) {
    const { single } = this,
      base = this.doc.placedSource();
    if (!single) return;
    if (base === undefined) return void this.change(undefined);
    const picture = this.doc.layout(base),
      box = boxOf(picture, single.id);
    if (!box) return;
    const sized = change.width !== undefined || change.height !== undefined,
      node = picture.diagram.nodes.get(single.id)!,
      next = { ...box, ...change };
    // A position moves the element with everything in it; a size is its own.
    const { places } = moversOf(picture.diagram, [single.id]);
    let source = place(base, shifted(places, next.x - box.x, next.y - box.y));
    if (sized || node.at?.width !== undefined)
      source = place(
        source,
        new Map([[single.id, { x: next.x, y: next.y, width: next.width, height: next.height }]]),
      );
    this.change(source);
  }

  /** Shows the whole diagram as large as the canvas allows; an empty one at its natural size. */
  fit() {
    const scene = this.picture?.scene;
    if (scene?.shapes.length && scene.bounds.width) this.view.fit(scene.bounds);
    else {
      this.view.zoom = 1;
      this.view.origin = { x: 80, y: 80 };
      this.view.invalidate();
      this.view.onView();
    }
  }

  /** Moves the selected elements by a step. */
  nudge(dx: number, dy: number) {
    if (this.structural) {
      if (!this.selectedElements.length) return;
      const moving = this.partMovers(this.selectedElements);
      if (!moving?.places.size) return;
      // Presses in a row are one step to undo.
      this.placeParts(
        setPlaces(moving.pinned, shifted(moving.places, dx, this.type === "sequence" ? 0 : dy)),
        "nudge",
      );
      return;
    }
    const base = this.doc.placedSource();
    if (base === undefined || !this.selectedElements.length) return;
    const moving = moversOf(parseTam(base), this.selectedElements);
    // Presses in a row are one step to undo, and what is moved stays in view.
    if (this.change(place(base, shifted(moving.places, dx, dy)), "nudge"))
      this.reveal(this.selectedElements[0]);
  }

  /**
   * Places a new element at a point of the diagram, inside the element there, and opens its name.
   * With `keep` the shape tool stays, to place another.
   */
  create(kind: ElementKind, at: Point, free = false, keep = false) {
    const base = this.doc.placedSource(),
      { picture } = this;
    if (base === undefined) return this.change(undefined);
    const parent = picture ? dropTarget(picture, at, new Set(), true) : null,
      spot = newSpot(picture, parent, dropPlace(kind, at, free));
    this.ghost = undefined;
    const added = addElement(base, {
      kind,
      label: NAMES[kind] || undefined,
      at: { ...spot, ...(kind === "group" ? sizeOf(kind) : {}) },
      parent,
    });
    const problem = this.doc.tryApply(added.source);
    if (problem) {
      this.notify(problem.message.replace(/^Line \d+: /, ""));
      return false;
    }
    if (!keep) this.setTool("select");
    // The first name typed for it becomes its id.
    this.fresh = added.id;
    this.select([{ type: "element", id: added.id }]);
    this.reveal(added.id);
    if (kind !== "group") this.rename(added.id);
    return true;
  }

  /** Shows where a new element would stand if dropped at a point of the diagram; without a point, hides it. */
  showGhost(kind: ElementKind, at: Point | undefined, free = false) {
    const { picture } = this;
    const target = at && picture ? dropTarget(picture, at, new Set(), true) : null;
    // An element the one under it cannot hold shows no place to stand.
    const fits =
      !target ||
      this.allows((source) => addElement(source, { kind, label: "x", parent: target }).source);
    this.ghost = at && fits ? { kind, at: dropPlace(kind, at, free), target } : undefined;
    this.view.canvas.style.cursor = at && !fits ? "not-allowed" : "";
    this.view.invalidate();
  }

  /** Opens the name of an element, or the label of a connection, for typing on the canvas. */
  rename(id: string, wire = false, at?: Point) {
    const { picture } = this;
    if (!picture || this.doc.problem) return;
    if (wire) this.renameWire(picture, id, at);
    else this.renameElement(picture, id);
  }

  /** Opens the label of a connection: the field lies on the label where it is drawn, its lines as lines; a connection without one gets it at the pointer. */
  private renameWire(picture: Picture, id: string, at: Point | undefined) {
    const wired = this.wireLabel(id);
    if (!wired || !at) return;
    const drawn = picture.scene.texts
      .filter(
        (text) => text.role === "label" && text.owner && wireOf(picture.diagram, text.owner) === id,
      )
      .map((text) => text.box);
    const box = drawn.length
      ? around(drawn)
      : { x: at.x - 60, y: at.y - 10, width: 120, height: 20 };
    const label = wired.text.replace(/<br\s*\/?>/gi, "\n");
    this.editText(box, label, { size: 12, weight: 400 }, (text) => {
      if (text !== undefined && text !== label) wired.set(text);
    });
  }

  /** Opens the name of an element. A start, an end, a fork: parts that carry no name open no field. */
  private renameElement(picture: Picture, id: string) {
    if (!this.nameable(id)) return;
    const node = picture.diagram.nodes.get(id),
      container = !!node?.children.length,
      box = this.nameBox(picture, id, container);
    const label = (node?.label ?? NAMES.agent).replace(/<br\s*\/?>/gi, "\n");
    this.editText(box, label, { size: 14, weight: container ? 600 : 400 }, (text) => {
      if (text !== undefined && text !== label) this.relabel(id, text);
    });
  }

  /**
   * Where the name of an element is typed: on the element, or the title of a container. The
   * element may be on its way: its picture comes after the layout, and the field opens at the pointer.
   */
  private nameBox(picture: Picture, id: string, container: boolean): Box {
    const box = boxOf(picture, id) ?? {
      x: this.pointer.x - 48,
      y: this.pointer.y - 20,
      width: 96,
      height: 40,
    };
    return container ? { ...box, height: Math.min(box.height, 34) } : box;
  }

  // Gestures.

  private down(event: PointerEvent) {
    const { view } = this,
      screen = view.pointOf(event),
      point = view.toScene(screen);
    this.pointer = point;
    // A text selection left in a panel would turn the next drag into a drag of that text.
    window.getSelection()?.removeAllRanges();
    view.canvas.setPointerCapture(event.pointerId);
    if (event.button === 2) return this.pressMenu(event, point);
    if (this.pans(event)) {
      this.gesture = { type: "pan", last: screen };
      this.cursor();
      return;
    }
    if (event.button !== 0 || this.pressTool(event, point)) return;
    if (this.pressMark(event, screen, point)) return;
    this.pressPart(event, screen, point);
  }

  /**
   * Whether a press pans: with the middle button, Space held or the hand tool. A picture that is
   * edited as text is moved about by dragging it.
   */
  private pans(event: PointerEvent): boolean {
    return (
      event.button === 1 ||
      this.space ||
      this.tool === "pan" ||
      (!this.editable && !this.structural)
    );
  }

  /** A right click selects what it is on, unless that is selected already, and asks for the menu. */
  private pressMenu(event: PointerEvent, point: Point) {
    const { view } = this,
      part = this.picture && partAt(this.picture, point, 6 / view.zoom);
    if (!part) this.select([]);
    else if (!this.isSelected(part)) this.select([part]);
    view.canvas.releasePointerCapture(event.pointerId);
    this.onMenu({ x: event.clientX, y: event.clientY }, point);
  }

  /** A press with a shape tool or the connect tool: true when the tool took it. */
  private pressTool(event: PointerEvent, point: Point): boolean {
    const shape = shapeOf(this.tool);
    if (shape) {
      // Placed on release, so the name that opens then keeps the focus.
      this.gesture = {
        type: "place",
        kind: shape,
        free: event.altKey,
        keep: this.sticky || event.shiftKey,
      };
      return true;
    }
    if (this.tool !== "connect") return false;
    const part = this.picture && partAt(this.picture, point, 6 / this.view.zoom);
    if (part?.type === "element") this.gesture = { type: "connect", from: part.id, current: point };
    return true;
  }

  /**
   * A press on what the selection shows besides the parts: a handle, an end of the selected
   * connection, a connection dot, the border of a lane, a label. True when one took it.
   */
  private pressMark(event: PointerEvent, screen: Point, point: Point): boolean {
    const handle = this.handleAt(screen);
    if (handle && this.picture) {
      this.startResize(handle.id, handle.handle, point);
      return true;
    }
    const end = this.endAt(screen);
    if (end) {
      this.gesture = { type: "attach", ...end, current: point };
      return true;
    }
    const link = this.linkAt(screen);
    if (link) {
      this.gesture = {
        type: "connect",
        from: link.id,
        current: point,
        dot: { screen },
      };
      return true;
    }
    // The border after a lane of an activity with lanes is dragged to give the lane a width.
    const lane = this.laneEdgeAt(screen);
    if (lane) {
      this.gesture = { type: "lane", ...lane, start: point, base: this.doc.source };
      return true;
    }
    return this.pressLabel(event, point);
  }

  /** A connection's label is dragged where it should stand; a press without a drag selects the connection. */
  private pressLabel(event: PointerEvent, point: Point): boolean {
    const { picture } = this,
      label = event.shiftKey ? undefined : this.labelAt(point);
    if (!label || !picture) return false;
    if (!this.isSelected({ type: "wire", id: label.id }))
      this.select([{ type: "wire", id: label.id }]);
    this.gesture = { type: "label", ...label, start: point, picture };
    return true;
  }

  /**
   * A press on a part selects it, with Shift adds it to the selection or takes it out, and starts
   * a move of a selected element; on the empty canvas it starts a frame.
   */
  private pressPart(event: PointerEvent, screen: Point, point: Point) {
    const part = this.picture && partAt(this.picture, point, 6 / this.view.zoom);
    if (!part) {
      const kept = event.shiftKey ? this.selection : [];
      this.select(kept);
      this.gesture = { type: "frame", start: point, current: point, kept };
      return;
    }
    if (this.framesInside(event, point, part)) {
      this.gesture = { type: "frame", start: point, current: point, kept: [], inside: part };
      return;
    }
    this.pick(part, event.shiftKey);
    if (part.type === "element" && this.isSelected(part))
      this.gesture = { type: "move", screen, start: point };
  }

  /** Selects a part; with Shift adds it to the selection, or takes it out when it is selected. */
  private pick(part: Part, adding: boolean) {
    if (adding)
      this.select(
        this.isSelected(part)
          ? this.selection.filter((other) => !samePart(other, part))
          : [...this.selection, part],
      );
    else if (!this.isSelected(part)) this.select([part]);
  }

  /**
   * Whether a drag that starts on a part frames what it holds: inside a container that is not
   * selected, below its title. Its title, or the container once selected, moves it.
   */
  private framesInside(event: PointerEvent, point: Point, part: Part): boolean {
    return (
      part.type === "element" &&
      this.editable &&
      !event.shiftKey &&
      !this.isSelected(part) &&
      this.belowTitle(part.id, point)
    );
  }

  /** Whether a point lies in an element that holds others, below its title. */
  private belowTitle(id: string, point: Point): boolean {
    const { picture } = this,
      held = picture && boxOf(picture, id);
    return !!held && !!picture.diagram.nodes.get(id)?.children.length && point.y > held.y + 36;
  }

  private move(event: PointerEvent) {
    const { view, gesture } = this,
      screen = view.pointOf(event),
      point = view.toScene(screen);
    this.pointer = point;
    this.onPointer(point);
    if (!gesture) return this.hoverAt(screen, point, event);
    (this.follow[gesture.type] as (gesture: Gesture, at: Pointed) => void)(gesture, {
      screen,
      point,
      event,
    });
  }

  /** How each gesture follows the pointer as it moves. */
  private readonly follow: {
    [T in Gesture["type"]]: (gesture: GestureOf<T>, at: Pointed) => void;
  } = {
    pan: (gesture, { screen }) => {
      this.view.panBy(screen.x - gesture.last.x, screen.y - gesture.last.y);
      gesture.last = screen;
    },
    frame: (gesture, { point }) => this.dragFrame(gesture, point),
    attach: (gesture, { point }) => this.dragEnd(gesture, point),
    connect: (gesture, { point }) => this.dragConnection(gesture, point),
    move: (gesture, { screen, point, event }) => this.drag(gesture, screen, point, event),
    resize: (gesture, { point, event }) => this.resize(gesture, point, this.free(event)),
    place: (gesture, { point, event }) => this.showGhost(gesture.kind, point, event.altKey),
    label: (gesture, { screen, point }) => this.dragLabel(gesture, screen, point),
    lane: (gesture, { point }) => this.dragLane(gesture, point),
  };

  /** The pointer moves with no button pressed: what it is over shows, and a new element with a shape tool. */
  private hoverAt(screen: Point, point: Point, event: PointerEvent) {
    this.showHover(point);
    this.keepLinkHost(point);
    const shape = shapeOf(this.tool);
    if (shape) this.showGhost(shape, point, event.altKey);
    if (this.linkHost) this.view.invalidate();
    this.cursor(screen);
  }

  /** Shows the part under the pointer as the one it is over. */
  private showHover(point: Point) {
    const { picture, view } = this,
      hover = picture && this.tool !== "pan" ? partAt(picture, point, 6 / view.zoom) : undefined;
    if (!samePart(hover, this.hover) && (hover || this.hover)) {
      this.hover = hover;
      view.invalidate();
    }
  }

  /** The dots of the element the pointer is over show, and stay while the pointer is on its way to them. */
  private keepLinkHost(point: Point) {
    const { picture, hover } = this,
      host =
        this.tool !== "select" ? undefined : hover?.type === "element" ? hover.id : this.linkHost,
      near = host && picture ? boxOf(picture, host) : undefined,
      kept =
        near && contains(near, point, (REACH + HANDLE + 2) / this.view.zoom) ? host : undefined;
    if (kept === this.linkHost) return;
    this.linkHost = kept;
    this.view.invalidate();
  }

  /** A selection frame follows the pointer: what lies wholly inside it is selected, with what was kept. */
  private dragFrame(gesture: GestureOf<"frame">, point: Point) {
    gesture.current = point;
    if (this.picture) {
      const caught = elementsIn(this.picture, frameOf(gesture.start, point)).map((id): Part => ({
        type: "element",
        id,
      }));
      this.selection = [
        ...gesture.kept,
        ...caught.filter((part) => !gesture.kept.some((kept) => samePart(kept, part))),
      ];
      this.onState();
    }
    this.view.invalidate();
  }

  /** An end of a connection follows the pointer: only an element the connection may end at takes it. */
  private dragEnd(gesture: GestureOf<"attach">, point: Point) {
    gesture.current = point;
    const part = this.picture && partAt(this.picture, point, 0);
    gesture.target =
      part?.type === "element" && this.allowsWire(gesture.id, { [gesture.end]: part.id })
        ? part.id
        : undefined;
    this.view.invalidate();
  }

  /**
   * A connection being drawn follows the pointer. A part of a structure may join itself: a self
   * message, a transition back to its state. In a block diagram only an element the connection
   * may reach takes it.
   */
  private dragConnection(gesture: GestureOf<"connect">, point: Point) {
    gesture.current = point;
    const target = this.targetAt(point);
    gesture.target =
      target &&
      (target !== gesture.from || this.structural) &&
      (this.structural || this.reaches(gesture, target))
        ? target
        : undefined;
    this.view.invalidate();
  }

  /**
   * The far border of a lane of an activity with lanes at a point of the canvas: the line between
   * it and the next lane, or the frame's edge after the last. A lane without a name has no width
   * of its own to set.
   */
  private laneEdgeAt(screen: Point): LaneBorder | undefined {
    const { picture } = this;
    if (this.type !== "swimlane" || this.tool !== "select" || !picture || this.doc.problem)
      return undefined;
    const lanes = laneFrame(picture.scene);
    return lanes && laneBorderAt(lanes, this.view.toScene(screen), HANDLE / 2 / this.view.zoom);
  }

  /**
   * Gives the lane whose border is dragged the width the pointer says. Where the parts are placed,
   * those of the lanes after it move with the border, so they keep their place in their lane.
   */
  private dragLane(gesture: GestureOf<"lane">, point: Point) {
    const width = Math.max(
      1,
      Math.round(gesture.width + point[gesture.across] - gesture.start[gesture.across]),
    );
    if (width === gesture.now) return;
    gesture.now = width;
    const result = this.shiftLanesAfter(setLane(gesture.base, gesture.id, width), gesture, width);
    if (this.doc.preview(result)) gesture.result = result;
  }

  /** Moves the placed parts of the lanes after a dragged border with it. */
  private shiftLanesAfter(source: string, gesture: GestureOf<"lane">, width: number): string {
    const { picture } = this,
      lanes = picture && laneFrame(picture.scene),
      places = readPlaces(source);
    if (!lanes || !places.size || !picture.parts) return source;
    const moved = lanesShifted(
      places,
      picture.parts,
      new Set(lanes.ids.slice(gesture.index + 1)),
      gesture.across,
      width - gesture.width,
    );
    return moved.size ? setPlaces(source, moved) : source;
  }

  /** Moves a connection's label with the pointer: shown at once, written to the source when let go. */
  private dragLabel(gesture: GestureOf<"label">, screen: Point, point: Point) {
    const start = this.view.toScreen(gesture.start);
    if (!gesture.moved && Math.hypot(screen.x - start.x, screen.y - start.y) < SLOP) return;
    const dx = Math.round(point.x - gesture.start.x),
      dy = Math.round(point.y - gesture.start.y),
      { scene } = gesture.picture;
    gesture.moved = { ...gesture.box, x: gesture.box.x + dx, y: gesture.box.y + dy };
    const group = new Set(labelGroups(scene).get(gesture.wire));
    this.doc.previewScene({
      ...scene,
      texts: scene.texts.map((text) =>
        group.has(text)
          ? {
              ...text,
              x: text.x + dx,
              y: text.y + dy,
              box: { ...text.box, x: text.box.x + dx, y: text.box.y + dy },
            }
          : text,
      ),
    });
  }

  /** The label of a connection at a point of the picture: the connection, its wire and the box around the label. */
  private labelAt(point: Point): { id: string; wire: string; box: Box } | undefined {
    const { picture } = this;
    if (!picture || (!this.editable && !this.structural)) return undefined;
    for (const [wire, texts] of labelGroups(picture.scene)) {
      if (!texts.some((text) => contains(text.box, point, 2))) continue;
      const id = wireOf(picture.diagram, wire);
      if (id) return { id, wire, box: textGroupBox(texts) };
    }
    return undefined;
  }

  /**
   * Ends a drag of a lane's border: the width is written. A lane is never narrower than its nodes
   * need, which the picture of the drag shows: that width is written rather than a smaller one.
   */
  private dropLane(gesture: GestureOf<"lane">) {
    const { result, now } = gesture;
    if (result === undefined || now === undefined) return this.doc.cancel();
    const drawn = this.drawnLaneWidth(result, gesture.index),
      next = drawn !== undefined && drawn > now + 0.5 ? setLane(result, gesture.id, drawn) : result;
    if (next === this.doc.source) return this.doc.cancel();
    void this.doc.apply(next);
  }

  /** The width a lane is drawn at in the picture of a source, while that picture is on show. */
  private drawnLaneWidth(source: string, index: number): number | undefined {
    const shown = this.doc.picture?.source === source ? this.doc.picture : undefined,
      lanes = shown && laneFrame(shown.scene);
    return lanes ? lanes.bounds[index + 1] - lanes.bounds[index] : undefined;
  }

  /**
   * Stands the label of a connection with its box at `box` in the picture the drag started on: as
   * an offset from the middle of its line, which moves with the line; without a box where the
   * layout puts it.
   */
  placeLabel(id: string, wire: string, picture: Picture, box: Box | undefined) {
    const offset = box && labelOffset(picture.scene, wire, box);
    if (box && !offset) return;
    if (this.structural) {
      if (this.doc.problem) return void this.change(undefined);
      void this.doc.apply(setLabel(this.doc.source, labelKey(wire), offset));
      return;
    }
    this.edit((source) => placeLabel(source, id, offset));
  }

  /** Whether the label of a connection stands where the source places it, not where the layout put it. */
  labelPlaced(id: string): boolean {
    if (this.structural) return readLabels(this.doc.source).has(id);
    return !!this.connection(id)?.labelAt;
  }

  /** Puts the label of a connection back where the layout puts it. */
  unplaceLabel(id: string) {
    const { picture } = this;
    if (picture) this.placeLabel(id, id, picture, undefined);
  }

  /** Moves the selected elements with the pointer, into the container under it. */
  private drag(gesture: GestureOf<"move">, screen: Point, point: Point, event: PointerEvent) {
    if (this.structural) return this.dragParts(gesture, screen, point, event);
    if (!gesture.base && !this.startMove(gesture, screen, event)) return;
    const base = gesture.base!,
      { picture, outer, places } = base;
    // The first element lands on the grid; the others keep their distance to it.
    const lead = places.get(outer[0]) ?? [...places.values()][0];
    if (!lead) return;
    const box = boxAround(picture, outer);
    const { x: dx, y: dy } = this.step(gesture, point, event, box, lead);
    const moved = place(picture.source, shifted(places, dx, dy)),
      { result, target } = droppedInto(
        base,
        moved,
        box && { ...box, x: box.x + dx, y: box.y + dy },
        point,
      );
    gesture.target = target;
    if (this.doc.preview(result)) gesture.result = result;
  }

  /**
   * Starts a move once the pointer went SLOP away: from the source with every element placed, or
   * with Ctrl from copies of the elements, which are dragged away while the originals stay. False
   * while the move has not started.
   */
  private startMove(gesture: GestureOf<"move">, screen: Point, event: PointerEvent): boolean {
    if (!movedPast(screen, gesture.screen)) return false;
    const source = this.doc.placedSource();
    if (source === undefined) {
      this.gesture = undefined;
      this.change(undefined);
      return false;
    }
    const copies =
      event.ctrlKey || event.metaKey
        ? duplicate(source, this.selectedElements, { x: 0, y: 0 })
        : undefined;
    if (copies?.ids.length) {
      const picture = this.doc.layout(copies.source);
      gesture.copies = copies.ids;
      gesture.base = { picture, ...moversOf(picture.diagram, copies.ids) };
    }
    gesture.base ??= this.grabbed(gesture, source);
    return true;
  }

  /**
   * What a move of the selected elements starts from. Grabbed by its copy, an element shown as
   * several moves the copy alone: beside it, below it, anywhere.
   */
  private grabbed(gesture: GestureOf<"move">, source: string): NonNullable<typeof gesture.base> {
    const picture = this.doc.layout(source),
      [only] = this.selectedElements,
      copy = this.selectedElements.length === 1 ? boxOf(picture, `${only}#2`) : undefined;
    return copy && contains(copy, gesture.start)
      ? {
          picture,
          outer: [],
          places: new Map([[`${only}#2`, { x: copy.x, y: copy.y }]]),
          all: new Set([only]),
        }
      : { picture, ...moversOf(picture.diagram, this.selectedElements) };
  }

  /**
   * How far a move has come: what is moved lines up with the edges and middles of the other
   * elements, or evenly between them, where the pointer brings it near; else its first element,
   * placed at `lead`, lands on the grid. `box` is the box around what moves, before the move.
   * Sets the guides of the gesture.
   */
  private step(
    gesture: GestureOf<"move">,
    point: Point,
    event: PointerEvent,
    box: Box | undefined,
    lead: Point,
  ): Point {
    const { picture, all } = gesture.base!;
    // With Shift the move keeps to one axis: the one the pointer went further along.
    let { x: dx, y: dy } = alongOneAxis(
      { x: point.x - gesture.start.x, y: point.y - gesture.start.y },
      event.shiftKey,
    );
    gesture.guides = [];
    const free = this.free(event);
    const others = elementShapes(picture)
      .filter(({ id }) => !all.has(id))
      .map(({ shape }) => shape.box);
    const snapped =
      box && !free
        ? snapMove({ ...box, x: box.x + dx, y: box.y + dy }, others, ALIGN / this.view.zoom)
        : undefined;
    // Whole steps, so that the source holds whole numbers.
    dx = snapped?.x ? Math.round(dx + snapped.dx) : snap(lead.x + dx, free) - lead.x;
    dy = snapped?.y ? Math.round(dy + snapped.dy) : snap(lead.y + dy, free) - lead.y;
    if (box && snapped) gesture.guides = guidesAt({ ...box, x: box.x + dx, y: box.y + dy }, others);
    return { x: dx, y: dy };
  }

  /**
   * Moves the selected parts of a diagram with a structure with the pointer: the first move places
   * every part where it stands, then the places of what is moved follow the pointer. A group
   * under the moved parts shows as what they would be dropped into, where the structure moves
   * parts between groups. The participants of a sequence diagram move along their row only.
   */
  private dragParts(gesture: GestureOf<"move">, screen: Point, point: Point, event: PointerEvent) {
    if (!gesture.base && !this.startPartsMove(gesture, screen)) return;
    const base = gesture.base!,
      { picture, places, pinned } = base,
      [lead] = places.values(),
      box = around([...places.keys()].flatMap((shape) => boxOf(picture, shape) ?? []));
    const by = this.step(gesture, point, event, box, lead);
    if (this.type === "sequence") by.y = 0;
    const result = setPlaces(pinned!, shifted(places, by.x, by.y));
    gesture.target = this.partsTarget(base, { ...box, x: box.x + by.x, y: box.y + by.y }, point);
    if (this.doc.preview(result)) gesture.result = result;
  }

  /** Starts a move of parts once the pointer went SLOP away. False while it has not started. */
  private startPartsMove(gesture: GestureOf<"move">, screen: Point): boolean {
    if (!movedPast(screen, gesture.screen)) return false;
    const moving = this.partMovers(this.selectedElements);
    // A part that takes no place stays: a lane, a note of a sequence diagram.
    if (!moving?.places.size) {
      this.gesture = undefined;
      return false;
    }
    gesture.base = moving;
    return true;
  }

  /**
   * The group moved parts that stand at `now` would go into: dropped onto a group the parts move
   * into it, and out of theirs once they are wholly outside it. Undefined while they stay where
   * they are, or where the structure moves no parts between groups.
   */
  private partsTarget(
    base: NonNullable<GestureOf<"move">["base"]>,
    now: Box,
    point: Point,
  ): string | null | undefined {
    const { picture, outer } = base,
      home = sharedGroup(picture, outer);
    if (!this.movesBetweenGroups || home === undefined) return undefined;
    const homeBox = home ? boxOf(picture, home) : undefined,
      target = this.partsLanding(base, now, point, home);
    if (target === home) return undefined;
    const fits = target ? this.allowsMove(outer, target) : !homeBox || !overlaps(now, homeBox);
    return fits ? target : undefined;
  }

  /** Whether parts are moved between groups by dragging them: the structure moves them, and a sequence diagram has none. */
  private get movesBetweenGroups(): boolean {
    return !!this.structure?.moveInto && this.type !== "sequence";
  }

  /** The group moved parts standing at `now` land in: the lane under the pointer, or the group their middle is in. */
  private partsLanding(
    { picture, all }: NonNullable<GestureOf<"move">["base"]>,
    now: Box,
    point: Point,
    home: string | null,
  ): string | null {
    if (this.type === "swimlane") return this.laneAt(point) ?? home;
    return dropTarget(picture, { x: now.x + now.width / 2, y: now.y + now.height / 2 }, all, false);
  }

  /** Ends a move of parts of a structure: their places are committed, and they change their group where dropped onto one. */
  private dropParts(gesture: GestureOf<"move">) {
    const { structure } = this,
      { base, result, target } = gesture;
    if (!base) return;
    if (result === undefined || !structure) return this.doc.cancel();
    let next = result;
    if (target !== undefined && structure.moveInto) {
      try {
        const moved = base.outer.reduce(
          (source, id) => structure.moveInto!(source, id, target),
          result,
        );
        parseUml(moved);
        next = followPlaces(structure.read, result, moved);
      } catch {
        // The part cannot stand there: it stays in its group, where it was dropped.
      }
    }
    if (next === this.doc.source) return this.doc.cancel();
    void this.doc.apply(next);
  }

  private startResize(id: string, handle: Handle, start: Point) {
    const base = this.doc.placedSource();
    if (base === undefined) return void this.change(undefined);
    try {
      const picture = this.doc.layout(base),
        box = boxOf(picture, id)!,
        container = !!picture.diagram.nodes.get(id)?.children.length;
      // Without its placement the element shows what it needs: a leaf its size, a container the box around its parts.
      const least = boxOf(this.doc.layout(place(base, new Map([[id, undefined]]))), id)!;
      const held = moversOf(picture.diagram, [id]).all,
        others = elementShapes(picture)
          .filter((item) => !held.has(item.id))
          .map(({ shape }) => shape.box);
      this.gesture = { type: "resize", id, handle, start, base, box, least, container, others };
    } catch {
      this.notify("This element cannot be resized.");
    }
  }

  private resize(gesture: GestureOf<"resize">, point: Point, free: boolean) {
    const { handle, least, container } = gesture,
      dragged = this.draggedEdges(gesture, point, free),
      { left, top, right, bottom } =
        container && "x" in least ? holding(dragged, least) : leastApart(dragged, least, handle);
    // A leaf at its least size needs none: its name sizes it.
    const natural =
      !container &&
      right - left <= Math.ceil(least.width) &&
      bottom - top <= Math.ceil(least.height);
    const at: Placement = natural
      ? { x: left, y: top }
      : { x: left, y: top, width: right - left, height: bottom - top };
    const result = place(gesture.base, new Map([[gesture.id, at]]));
    if (this.doc.preview(result)) gesture.result = result;
  }

  /**
   * The edges of a resized element where the pointer drags them. A dragged edge comes to rest on
   * the edges of other elements near it, else on the grid. Sets the guides of the gesture.
   */
  private draggedEdges(gesture: GestureOf<"resize">, point: Point, free: boolean): Edges {
    const { box, handle } = gesture,
      dx = point.x - gesture.start.x,
      dy = point.y - gesture.start.y,
      reach = ALIGN / this.view.zoom,
      guides: Guide[] = [];
    gesture.guides = guides;
    const edge = (value: number, axis: "x" | "y") => {
      const found = free ? { value } : snapEdge(value, axis, box, gesture.others, reach);
      if (!("guide" in found) || !found.guide) return snap(value, free);
      guides.push(found.guide);
      return found.value;
    };
    return {
      left: handle.x < 0 ? edge(box.x + dx, "x") : box.x,
      right: handle.x > 0 ? edge(box.x + box.width + dx, "x") : box.x + box.width,
      top: handle.y < 0 ? edge(box.y + dy, "y") : box.y,
      bottom: handle.y > 0 ? edge(box.y + box.height + dy, "y") : box.y + box.height,
    };
  }

  private up(event: PointerEvent) {
    const { gesture, view } = this;
    this.gesture = undefined;
    if (view.canvas.hasPointerCapture(event.pointerId))
      view.canvas.releasePointerCapture(event.pointerId);
    if (!gesture) return;
    (this.finish[gesture.type] as (gesture: Gesture, event: PointerEvent) => void)(gesture, event);
    view.invalidate();
    this.cursor(view.pointOf(event));
    if (gesture.type !== "frame" && gesture.type !== "pan") this.onState();
  }

  /** How each gesture ends when the pointer is let go. */
  private readonly finish: {
    [T in Gesture["type"]]: (gesture: GestureOf<T>, event: PointerEvent) => void;
  } = {
    move: (gesture) => this.dropMove(gesture),
    resize: (gesture) => this.dropResize(gesture),
    attach: (gesture) => this.dropEnd(gesture),
    connect: (gesture, event) => this.dropConnection(gesture, event),
    place: (gesture, event) =>
      void this.create(
        gesture.kind,
        this.view.toScene(this.view.pointOf(event)),
        gesture.free,
        gesture.keep,
      ),
    frame: (gesture) => this.dropFrame(gesture),
    label: (gesture) => {
      if (gesture.moved) this.placeLabel(gesture.id, gesture.wire, gesture.picture, gesture.moved);
    },
    lane: (gesture) => this.dropLane(gesture),
    pan: () => {},
  };

  /** Ends a move: the elements stand where they were dropped, and copies dragged with Ctrl are selected. */
  private dropMove(gesture: GestureOf<"move">) {
    if (this.structural) return this.dropParts(gesture);
    if (gesture.result !== undefined && gesture.result !== this.doc.source) {
      const done = this.change(gesture.result);
      if (done && gesture.copies)
        this.select(gesture.copies.map((id) => ({ type: "element", id })));
    } else if (gesture.base) this.doc.cancel();
  }

  /** Ends a resize: the element keeps the size it was given. */
  private dropResize(gesture: GestureOf<"resize">) {
    if (gesture.result !== undefined && gesture.result !== this.doc.source)
      this.change(gesture.result);
    else this.doc.cancel();
  }

  /** Ends a drag of an end of a connection: on an element it may end at, it ends there. */
  private dropEnd(gesture: GestureOf<"attach">) {
    if (gesture.target) return this.setWire(gesture.id, { [gesture.end]: gesture.target });
    // Dropped on an element the connection cannot end at: the notation's reason is said.
    const part = this.picture && partAt(this.picture, gesture.current, 0),
      why =
        part?.type === "element"
          ? this.refusal((source) => setConnection(source, gesture.id, { [gesture.end]: part.id }))
          : undefined;
    if (why) this.notify(why);
  }

  /** Ends the drawing of a connection: to the element it reaches, or to a new one on the empty canvas. */
  private dropConnection(gesture: GestureOf<"connect">, event: PointerEvent) {
    const clicked = gesture.dot && !movedPast(this.view.pointOf(event), gesture.dot.screen);
    // A dot is dragged: a click on one only selects its element, so a slip adds nothing.
    if (clicked) return this.select([{ type: "element", id: gesture.from }]);
    if (gesture.target) return this.connect(gesture.from, gesture.target);
    // Dropped on an element the connection cannot reach: the notation's reason is said.
    const target = this.structural ? undefined : this.targetAt(gesture.current),
      why =
        target && target !== gesture.from ? this.connectRefusal(gesture.from, target) : undefined;
    if (why) this.notify(why);
    else this.connectNew(gesture.from, gesture.current);
  }

  /** Ends a frame: a press without a drag inside a container selects the container. */
  private dropFrame(gesture: GestureOf<"frame">) {
    if (
      gesture.inside &&
      Math.hypot(gesture.current.x - gesture.start.x, gesture.current.y - gesture.start.y) *
        this.view.zoom <
        SLOP
    )
      this.select([gesture.inside]);
    // The selection the frame made shows in the panels once it is done.
    this.onState();
  }

  /** Connects two elements with the word that fits them and selects the connection. */
  connect(from: string, to: string) {
    if (this.structure) return this.joinParts(this.structure, from, to);
    const change = this.linkChange;
    if (!this.edit((source) => connect(source, from, to, change))) return;
    const made = parseTam(this.doc.source).edges.findLast((edge) => !edge.id.includes("#"));
    this.tool = "select";
    if (made) this.select([{ type: "wire", id: made.id }]);
  }

  /**
   * Joins two parts of a structure and selects the join. Ids of joins are often their position. A
   * structure that says which join it wrote is asked; else the new one is told by what it says,
   * the last of its like. In a diagram whose joins are ordered, the new one follows the selected one.
   */
  private joinParts(structure: Structure, from: string, to: string) {
    const count = joinCounts(this.picture?.joins?.values() ?? []),
      after = this.onlyWire;
    let written: string | undefined;
    const done = this.structEdit((edits, source) => {
      if (!edits.join) return edits.connect(source, from, to, this.link);
      const result = edits.join(source, from, to, this.link, after);
      written = result.edge;
      return result.source;
    });
    if (!done) return;
    const made = madeJoin(structure.read(this.doc.source).edges, written, count);
    this.tool = "select";
    if (!made) return void this.notify(this.unjoined(from, to));
    this.select([{ type: "wire", id: made.id }]);
    // A message says something: its text opens for typing.
    if (this.type === "sequence") void this.whenShown().then(() => this.openMessage(made.id));
  }

  /** The one selected connection, when nothing else is selected. */
  private get onlyWire(): string | undefined {
    const [chosen] = this.selectedWires;
    return this.selection.length === 1 ? chosen : undefined;
  }

  /** Why two parts were not joined: they are joined that way already, or cannot be. */
  private unjoined(from: string, to: string): string {
    const joins = this.doc.picture?.joins;
    return joins && [...joins.values()].some((edge) => edge.source === from && edge.target === to)
      ? "These two are joined that way already."
      : "These two cannot be joined that way.";
  }

  /** Opens the text of a message of a sequence diagram, at the middle of its arrow. */
  private openMessage(id: string) {
    const wire = this.picture?.scene.wires.find((item) => item.edge === id),
      middle = wire?.points[Math.floor(wire.points.length / 2)];
    if (middle) this.rename(id, true, middle);
  }

  /** A connection dropped on the empty canvas ends at a new agent there. */
  private connectNew(from: string, at: Point) {
    if (!this.structure) return this.connectNewElement(from, at);
    // Only on the empty canvas: a note or a frame under the pointer is no place for a new part.
    if (!this.drawnAt(at)) this.addPiece(this.structure.pieces[0].kind, from, undefined, true, at);
  }

  /** A connection of a block diagram dropped well away from its element, onto nothing, ends at a new element there. */
  private connectNewElement(from: string, at: Point) {
    const { picture } = this,
      base = this.doc.placedSource(),
      start = picture && boxOf(picture, from);
    if (!picture || base === undefined || !start) return;
    if (awayFrom(start, at) < 3 * GRID || partAt(picture, at, 0)) return;
    const change = this.linkChange,
      kind = endKind(change),
      added = addElement(base, { kind, label: NAMES[kind], at: dropPlace(kind, at, false) });
    if (!this.change(connectedOr(added.source, from, added.id, change))) return;
    this.tool = "select";
    this.select([{ type: "element", id: added.id }]);
    this.rename(added.id);
  }

  private abort() {
    const { gesture } = this;
    this.gesture = undefined;
    if (gesture && showsPreview(gesture)) this.doc.cancel();
    this.view.invalidate();
  }

  private doubleClick(event: MouseEvent) {
    const point = this.view.toScene(this.view.pointOf(event)),
      { picture } = this;
    if (this.tool !== "select" || (!this.editable && !this.structural)) return;
    const part = picture && partAt(picture, point, 6 / this.view.zoom);
    if (!part) {
      if (!this.structure) this.create("agent", point, event.altKey);
      else if (!this.drawnAt(point))
        this.addPiece(this.structure.pieces[0].kind, null, this.laneAt(point), false, point);
    } else if (part.type === "element") this.rename(part.id);
    else this.rename(part.id, true, point);
  }

  private wheel(event: WheelEvent) {
    event.preventDefault();
    const { view } = this;
    // A pinch or Ctrl with the wheel zooms; the wheel alone moves the view, as trackpads expect.
    if (event.ctrlKey || event.metaKey)
      view.zoomBy(Math.exp(-event.deltaY * 0.01), view.pointOf(event));
    else if (event.shiftKey && !event.deltaX) view.panBy(-event.deltaY, 0);
    else view.panBy(-event.deltaX, -event.deltaY);
  }

  private key(event: KeyboardEvent) {
    if (keysElsewhere(event)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key,
      keys = event.ctrlKey || event.metaKey ? COMMAND_KEYS : PLAIN_KEYS;
    keys.get(key)?.(this, event);
  }

  /** Escape: ends the gesture under way, else the tool, else the selection. */
  escape() {
    if (this.gesture) this.abort();
    else if (this.tool !== "select") this.setTool("select");
    else this.select([]);
  }

  /** Space is held: the canvas is dragged about until it is let go. */
  holdSpace() {
    this.space = true;
    this.cursor();
  }

  // What lies over the picture.

  /** What the pointer is doing on the canvas between its press and its release, for the hint in the status bar. */
  get doing(): Gesture["type"] | undefined {
    return this.gesture?.type;
  }

  /** The one selected element with its box, when handles show. */
  private get single(): { id: string; box: Box } | undefined {
    const { picture, selection } = this;
    if (!picture || selection.length !== 1 || selection[0].type !== "element") return undefined;
    const box = boxOf(picture, selection[0].id);
    return box && { id: selection[0].id, box };
  }

  /** The one selected element when its handles show: what the source places has a size to drag. */
  private get handled(): { id: string; box: Box } | undefined {
    return this.tool === "select" && this.editable ? this.single : undefined;
  }

  private handleAt(screen: Point) {
    const { handled } = this;
    if (!handled) return undefined;
    const found = handlePoints(this.view, handled.box).find(
      (spot) => Math.abs(spot.x - screen.x) <= HANDLE && Math.abs(spot.y - screen.y) <= HANDLE,
    );
    return found && { id: handled.id, handle: found.handle };
  }

  /**
   * The ends of the one selected connection, where it meets its elements: handles to drag to
   * another element. None for an interface's line.
   */
  private get wireEnds(): { id: string; end: "from" | "to"; at: Point }[] {
    const { picture } = this,
      [only] = this.selection;
    if (!picture || this.selection.length !== 1 || only.type !== "wire" || this.tool !== "select")
      return [];
    const connection = this.connection(only.id);
    if (!connection) return [];
    const points = wireParts(picture.scene, picture.diagram, only.id).lines.flat();
    return (["from", "to"] as const).flatMap((end) => {
      const box = boxOf(picture, connection[end]);
      if (!box || !points.length) return [];
      // The point of the wire nearest to the element.
      const away = (point: Point) =>
        Math.max(box.x - point.x, point.x - box.x - box.width, 0) +
        Math.max(box.y - point.y, point.y - box.y - box.height, 0);
      const at = points.reduce((best, point) => (away(point) < away(best) ? point : best));
      return [{ id: only.id, end, at }];
    });
  }

  private endAt(screen: Point) {
    return this.wireEnds.find(({ at }) => {
      const on = this.view.toScreen(at);
      return Math.hypot(on.x - screen.x, on.y - screen.y) <= HANDLE;
    });
  }

  /** The elements that show connection dots: the selected one and the one under the pointer. */
  private get linkHosts(): { id: string; box: Box }[] {
    const { picture, single } = this;
    if (!picture || this.tool !== "select") return [];
    const box =
      this.linkHost && this.linkHost !== single?.id ? boxOf(picture, this.linkHost) : undefined;
    return [...(single ? [single] : []), ...(box ? [{ id: this.linkHost!, box }] : [])];
  }

  /** The element whose connection dot lies at a point of the canvas. */
  private linkAt(screen: Point) {
    return this.linkHosts.find(({ box }) =>
      linkPoints(this.view, box).some(
        (spot) => Math.hypot(spot.x - screen.x, spot.y - screen.y) <= HANDLE,
      ),
    );
  }

  private cursor(screen?: Point) {
    this.view.canvas.style.cursor =
      this.gesture?.type === "pan"
        ? "grabbing"
        : this.space || this.tool === "pan"
          ? "grab"
          : this.tool !== "select"
            ? "crosshair"
            : screen
              ? this.cursorAt(screen)
              : "default";
  }

  /** The cursor at a point of the canvas with the select tool, in the order a press takes them: handles, ends and dots, lane borders, labels, parts. */
  private cursorAt(screen: Point): string {
    const handle = this.handleAt(screen);
    if (handle) return handle.handle.cursor;
    if (this.endAt(screen) || this.linkAt(screen)) return "crosshair";
    const lane = this.laneEdgeAt(screen);
    if (lane) return lane.across === "x" ? "col-resize" : "row-resize";
    if (this.labelAt(this.view.toScene(screen))) return "move";
    if (!this.hover) return "default";
    return this.hover.type === "element" ? "move" : "pointer";
  }

  private drawOverlay(context: CanvasRenderingContext2D) {
    const { picture } = this;
    if (!picture) return;
    const pen = new Pen(context, this.view, picture, this.accent);
    context.lineJoin = "round";
    this.drawSelected(pen);
    this.drawAids(pen);
    this.drawGesture(pen);
  }

  /** What the pointer is over, what lies on what, and the selection with its handles and dots. */
  private drawSelected(pen: Pen) {
    const { hover, gesture, handled } = this;
    if (hover && !gesture && this.tool !== "pan" && !this.isSelected(hover)) drawHover(pen, hover);
    drawOverlaps(pen);
    drawSelection(pen, this.selectedWires, this.selectedElements);
    if (handled && (!gesture || gesture.type === "resize")) drawHandles(pen, handled.box);
    if (!gesture)
      drawLinkDots(
        pen,
        this.linkHosts.map(({ box }) => box),
        this.view.toScreen(this.pointer),
      );
  }

  /** The lines a move is aligned on, a new element before it is placed, and the part a piece would join. */
  private drawAids(pen: Pen) {
    const { gesture, ghost } = this;
    const guides = guidesOf(gesture);
    if (guides.length) drawGuides(pen, guides);
    if (ghost && (!gesture || gesture.type === "place")) drawGhost(pen, ghost);
    if (this.pieceTarget) drawTarget(pen, this.pieceTarget);
  }

  /** An end of the selected connection dragged: the other end stays, and a line runs from it to the pointer. */
  private drawAttaching(pen: Pen, gesture: GestureOf<"attach">) {
    const others = this.wireEnds.filter((item) => item.end !== gesture.end);
    drawWireEnds(
      pen,
      others.map(({ at }) => at),
    );
    drawAttach(pen, gesture, others[0]?.at);
  }

  /** What a gesture under way shows; without one, the ends of the selected connection to drag. */
  private drawGesture(pen: Pen) {
    const { gesture } = this;
    if (!gesture)
      return drawWireEnds(
        pen,
        this.wireEnds.map(({ at }) => at),
      );
    switch (gesture.type) {
      case "move":
        if (gesture.target) drawTarget(pen, gesture.target);
        return;
      case "label":
        if (gesture.moved) drawLabelDrag(pen, gesture, gesture.moved);
        return;
      case "frame":
        return drawFrame(pen, gesture);
      case "attach":
        return this.drawAttaching(pen, gesture);
      case "connect":
        return drawConnect(pen, gesture);
    }
  }
}

/** The kind of element a tool places, if it is a shape tool. */
const shapeOf = (tool: Tool): ElementKind | undefined =>
  tool === "select" || tool === "pan" || tool === "connect" ? undefined : tool;

/** The outermost of some elements, and the placements of all that move with them. */
function moversOf(diagram: TamDiagram, ids: string[]) {
  const chosen = new Set(ids);
  const within = (id: string): boolean => {
    const parent = holder(diagram, id);
    return parent !== null && (chosen.has(parent) || within(parent));
  };
  const outer = ids.filter((id) => diagram.nodes.has(id) && !within(id));
  const places = new Map<string, Placement>(),
    all = new Set<string>();
  for (const id of outer) takeMovers(diagram, id, places, all);
  return { outer, places, all };
}

/** Takes an element with all it holds into what moves, with their placements. */
function takeMovers(
  diagram: TamDiagram,
  id: string,
  places: Map<string, Placement>,
  all: Set<string>,
) {
  const node = diagram.nodes.get(id)!;
  if (node.origin && node.origin !== id) return;
  if (!id.endsWith("#row")) {
    all.add(id);
    if (node.at) places.set(id, node.at);
  }
  // The copy of an element shown as several moves with it when it has a place of its own.
  const copy = diagram.nodes.get(`${id}#2`);
  if (copy?.origin === id && copy.at) places.set(copy.id, copy.at);
  for (const child of node.children) takeMovers(diagram, child, places, all);
}

/** What a move of elements of a block diagram starts from: the picture, and what moves. */
type MoveBase = NonNullable<GestureOf<"move">["base"]>;

/**
 * A moved source with the moved elements in the container they are dropped into, and that
 * container; none where they stay in theirs, or the notation forbids them there.
 */
function droppedInto(
  base: MoveBase,
  moved: string,
  now: Box | undefined,
  point: Point,
): { result: string; target?: string | null } {
  const { picture, outer } = base,
    target = moveTarget(base, now, point),
    into = outer.some((id) => holder(picture.diagram, id) !== target)
      ? movedInto(moved, outer, target)
      : undefined;
  return into === undefined ? { result: moved } : { result: into, target };
}

/**
 * The container moved elements standing at `now` go into: the one their middle is in, or an
 * element that holds nothing yet when they lie wholly inside it. They stay in their own while
 * they still overlap it: across the border it grows with them.
 */
function moveTarget(base: MoveBase, now: Box | undefined, point: Point): string | null {
  const found = now ? landing(base, now) : dropTarget(base.picture, point, base.all, false),
    home = homeOf(base);
  if (!home || !now || found === home.id || !overlaps(now, home.box)) return found;
  return found && moversOf(base.picture.diagram, [home.id]).all.has(found) ? found : home.id;
}

/** The element moved elements standing at `now` land in: one that holds nothing yet when they lie wholly inside it, else the container their middle is in. */
function landing({ picture, all }: MoveBase, now: Box): string | null {
  const middle = { x: now.x + now.width / 2, y: now.y + now.height / 2 },
    target = dropTarget(picture, middle, all, false),
    leaf = dropTarget(picture, middle, all, true),
    leafBox = leaf && leaf !== target ? boxOf(picture, leaf) : undefined;
  return leaf && leafBox && inside(now, leafBox) ? leaf : target;
}

/** The container all the outermost moved elements stand in, with its box, when they share one. */
function homeOf({ picture, outer }: MoveBase): { id: string; box: Box } | undefined {
  const home = outer.length ? holder(picture.diagram, outer[0]) : null,
    box = home ? boxOf(picture, home) : undefined;
  return home && box && outer.every((id) => holder(picture.diagram, id) === home)
    ? { id: home, box }
    : undefined;
}

/** A source with elements put into a container; undefined where the notation forbids them there. */
function movedInto(source: string, ids: string[], parent: string | null): string | undefined {
  try {
    const nested = moveInto(source, ids, parent);
    parseTam(nested);
    return nested;
  } catch {
    // The notation forbids the elements there: they stay in their container.
    return undefined;
  }
}

/** The group all of some parts stand in, null for none; undefined when they stand in different ones. */
function sharedGroup(picture: Picture, ids: string[]): string | null | undefined {
  const groupOf = (id: string) => picture.parts?.get(id)?.parent ?? null,
    home = groupOf(ids[0]);
  return ids.every((id) => groupOf(id) === home) ? home : undefined;
}

/** A step kept to one axis when asked: the one it goes further along. */
function alongOneAxis(step: Point, keep: boolean): Point {
  if (!keep) return step;
  return Math.abs(step.x) >= Math.abs(step.y) ? { x: step.x, y: 0 } : { x: 0, y: step.y };
}

/** The edges of a box being resized. */
type Edges = { left: number; top: number; right: number; bottom: number };

/** Edges that still hold a container's parts, whose box is `least`. */
const holding = (edges: Edges, least: Box): Edges => ({
  left: Math.min(edges.left, Math.floor(least.x)),
  top: Math.min(edges.top, Math.floor(least.y)),
  right: Math.max(edges.right, Math.ceil(least.x + least.width)),
  bottom: Math.max(edges.bottom, Math.ceil(least.y + least.height)),
});

/** Edges at least as far apart as a leaf's least size: the dragged edge stops there. */
function leastApart(edges: Edges, least: { width: number; height: number }, handle: Handle): Edges {
  const width = Math.ceil(least.width),
    height = Math.ceil(least.height);
  let { left, top, right, bottom } = edges;
  if (right - left < width) {
    if (handle.x < 0) left = right - width;
    else right = left + width;
  }
  if (bottom - top < height) {
    if (handle.y < 0) top = bottom - height;
    else bottom = top + height;
  }
  return { left, top, right, bottom };
}

/** Whether a piece joins a part of its kind: it joins only the kinds of part it has a join with. */
const fitsTo = (piece: Piece, node: StructureNode) =>
  !piece.joinsTo || piece.joinsTo.includes(node.kind);

/**
 * Where a piece added at a part stands: the group it goes in, and whether it is joined to the
 * part. Without a part it stands alone, in the lane given. `joined` joins it to the part whatever
 * the piece says, as a connection drawn to the empty canvas asks.
 */
function standing(
  piece: Piece,
  node: StructureNode | undefined,
  { lane, joined, sequence }: { lane?: string; joined: boolean; sequence: boolean },
): { parent: string | null; joins: boolean } {
  if (!node) return { parent: lane ?? null, joins: false };
  const beside = standsBeside(piece, node);
  return {
    parent: pieceParent(piece, node, beside, { lane, sequence }),
    joins: (!node.group || beside) && !piece.group && (joined || joinsTo(piece, node)),
  };
}

/**
 * The group a piece added at a part goes in. A note is for the part it is added at, and a
 * participant stands beside the one it is added at: those take the part itself; the others its
 * group, or the group it is.
 */
function pieceParent(
  piece: Piece,
  node: StructureNode,
  beside: boolean,
  { lane, sequence }: { lane?: string; sequence: boolean },
): string | null {
  const own = piece.kind === "note" || sequence || (node.group && !beside);
  return own ? node.id : (node.parent ?? lane ?? null);
}

/** Whether a piece joins a part by its own join. */
const joinsTo = (piece: Piece, node: StructureNode) => !!piece.joins && fitsTo(piece, node);

/**
 * Whether a piece added at a group stands at it, not in it: one without a name of its own that
 * joins a group, such as the end of a composite state.
 */
const standsBeside = (piece: Piece, node: StructureNode) =>
  node.group && !piece.named && joinsTo(piece, node);

/**
 * A piece just added, joined to `node` as the piece joins (a step follows, a start leads). Where
 * the parts are placed, the new one stands where it was dropped: unless the edit dropped the
 * places, as the first lane of an activity does.
 */
function joinedPiece(
  edits: Structure,
  added: { source: string; id: string },
  piece: Piece,
  node: StructureNode | undefined,
  spot: Point | undefined,
): string {
  const { source, id } = added;
  if (!id) return source;
  const next = !node
    ? source
    : piece.joins === "before"
      ? edits.connect(source, id, node.id)
      : edits.connect(source, node.id, id);
  return spot && hasPlaces(source)
    ? setPlaces(next, new Map([[id, { x: snap(spot.x - 48, false), y: snap(spot.y - 18, false) }]]))
    : next;
}

/** The participant of a sequence diagram whose lifeline runs down through a point. */
function lifelineAt(picture: Picture, point: Point): string | undefined {
  for (const [id, node] of picture.parts ?? []) {
    const box = node.group ? undefined : boxOf(picture, id);
    if (box && point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y) return id;
  }
  return undefined;
}

/** The lanes of a swimlane diagram that hold parts, with the box around their parts. */
function laneBoxes(picture: Picture): { id: string; box: Box }[] {
  const parts = [...(picture.parts?.values() ?? [])];
  return parts.flatMap((lane) => {
    if (!lane.group) return [];
    const boxes = parts.flatMap((node) =>
      node.parent === lane.id ? (boxOf(picture, node.id) ?? []) : [],
    );
    return boxes.length ? [{ id: lane.id, box: around(boxes) }] : [];
  });
}

/** Stands elements in a row below a box, a grid step under it, each with all that moves with it. */
function rowBelow(source: string, picture: Picture, ids: string[], into: Box): string {
  let next = source,
    x = into.x + 2 * GRID;
  for (const id of ids) {
    const box = boxOf(picture, id);
    if (!box) continue;
    const { places } = moversOf(picture.diagram, [id]);
    next = place(
      next,
      shifted(places, snap(x - box.x, false), snap(into.y + into.height + GRID - box.y, false)),
    );
    x += box.width + 2 * GRID;
  }
  return next;
}

/**
 * The shapes that take a place of some parts of a structure, with all that their groups hold:
 * what moves when the parts are moved.
 */
function placedShapes(picture: Picture, ids: string[]): string[] {
  const { parts } = picture,
    chosen = new Set(ids);
  const within = (id: string) => {
    for (let at = parts?.get(id); at; at = at.parent ? parts?.get(at.parent) : undefined)
      if (chosen.has(at.id)) return true;
    return false;
  };
  return placeable(picture.scene).filter((shape) => {
    const part = elementOf(picture.diagram, shape);
    return part !== undefined && within(part);
  });
}

/** The groups around a part of a structure, innermost first. */
function holdersOf(picture: Picture, id: string): string[] {
  const { parts } = picture,
    found: string[] = [];
  for (let at = parts?.get(id)?.parent; at; at = parts?.get(at)?.parent) found.push(at);
  return found;
}

/**
 * What moves with some parts of a structure: the outermost of them, the places of the shapes that
 * move with them, and every part among them.
 */
function partsMoving(picture: Picture, ids: string[]) {
  const { parts } = picture,
    chosen = new Set(ids),
    held = (id: string) => holdersOf(picture, id).some((at) => chosen.has(at)),
    boxes = new Map(picture.scene.shapes.map((shape) => [shape.id, shape.box]));
  return {
    outer: ids.filter((id) => parts?.has(id) && !held(id)),
    places: new Map<string, Placement>(
      placedShapes(picture, ids).map((shape) => {
        const box = boxes.get(shape)!;
        return [shape, { x: Math.round(box.x), y: Math.round(box.y) }];
      }),
    ),
    all: new Set([...(parts?.keys() ?? [])].filter((id) => chosen.has(id) || held(id))),
  };
}

/** Each outermost part as one box, its own or the one around what moves with it, with the shapes that move with it. */
function partUnits(picture: Picture, outer: string[]) {
  return new Map(
    outer.flatMap((id) => {
      const shapes = placedShapes(picture, [id]),
        box =
          boxOf(picture, id) ??
          (shapes.length ? around(shapes.flatMap((shape) => boxOf(picture, shape) ?? [])) : 0);
      return box && shapes.length ? [[id, { box, shapes }] as const] : [];
    }),
  );
}

/**
 * Where the copy of a placed part stands: beside its original, further down while something
 * stands there. The spot is taken. Undefined for a part that takes no place.
 */
function copySpot(picture: Picture, id: string, taken: Box[]): Point | undefined {
  const box = placeable(picture.scene).includes(id) && boxOf(picture, id);
  if (!box) return undefined;
  const spot = roomAt(
    { ...box, x: snap(box.x + box.width + 2 * GRID, false), y: Math.round(box.y) },
    (at) => ({ ...at, y: at.y + 2 * GRID }),
    (at) => at,
    taken,
  );
  taken.push(spot);
  return { x: spot.x, y: spot.y };
}

/** The message of what an edit threw, without the line it names. */
const reasonOf = (reason: unknown) =>
  (reason instanceof Error ? reason.message : String(reason)).replace(/^Line \d+: /, "");

/** Whether a diagram still shows a selected part. */
const shows = (diagram: TamDiagram, part: Part) =>
  part.type === "element"
    ? diagram.nodes.has(part.id)
    : diagram.edges.some((edge) => edge.id === part.id);

/** Whether a node of a block diagram is an element the source declares: no dots, interface, row or copy. */
const isDeclaredPart = (node: TamNode) =>
  node.kind !== "dots" &&
  node.kind !== "interface" &&
  !node.id.endsWith("#row") &&
  (!node.origin || node.origin === node.id);

/** Whether an element of a block diagram holds anything. */
const holdsAny = (diagram: TamDiagram, id: string) =>
  [...diagram.nodes.values()].some((node) => node.id !== id && holder(diagram, node.id) === id);

/** Whether an element belongs to the design level: a component, subsystem, class, package or interface. */
const isDesignNode = (node: TamNode) =>
  ["component", "subsystem", "class", "package", "interface"].includes(node.kind);

/** Whether a connection belongs to the design level: a delegation, an assembly, or a «use» or «import» dependency. */
const isDesignEdge = (edge: TamEdge) =>
  edge.kind === "delegation" ||
  edge.kind === "assembly" ||
  (edge.kind === "dependency" && /«(use|import)»/.test(edge.label ?? ""));

/**
 * A UML source with another header. A diagram whose parts are placed turns their places with its
 * direction, so the picture turns as the automatic layout would.
 */
function withUmlHeader(source: string, header: HeaderChange, picture: Picture | undefined): string {
  const next = setUmlHeader(source, header),
    from = umlHeader(source).direction,
    to = header.direction;
  if (!to || !from || from === to || !hasPlaces(source)) return next;
  const sizes = new Map(picture?.scene.shapes.map((shape) => [shape.id, shape.box]));
  return setPlaces(next, turnPlaces(readPlaces(source), sizes, from, to));
}

/**
 * Where a new element dropped at a spot stands: there; in an element that held nothing yet, below
 * where its title will be, so that the element grows down and right from where it stood.
 */
function newSpot(picture: Picture | undefined, parent: string | null, dropped: Point): Point {
  const host = parent && picture ? picture.diagram.nodes.get(parent) : undefined,
    box = parent && picture ? boxOf(picture, parent) : undefined;
  return host && box && !host.children.length
    ? {
        x: Math.max(dropped.x, snap(box.x + 14, false)),
        y: Math.max(dropped.y, snap(box.y + 44, false)),
      }
    : dropped;
}

/** What a join of a structure says: its ends and its kind. */
const says = (edge: StructureEdge) => `${edge.source}\u0000${edge.target}\u0000${edge.kind}`;

/** How many joins say each thing. */
function joinCounts(edges: Iterable<StructureEdge>): Map<string, number> {
  const count = new Map<string, number>();
  for (const edge of edges) count.set(says(edge), (count.get(says(edge)) ?? 0) + 1);
  return count;
}

/**
 * The join an edit made: the one the structure says it wrote, else the last of the joins that
 * say something more often than `count` had it.
 */
function madeJoin(
  edges: StructureEdge[],
  written: string | undefined,
  count: Map<string, number>,
): StructureEdge | undefined {
  if (written !== undefined) return edges.find((edge) => edge.id === written);
  return edges.findLast(
    (edge) =>
      edges.filter((other) => says(other) === says(edge)).length > (count.get(says(edge)) ?? 0),
  );
}

/** How far a point lies out from a box, along the axis it is furthest out on. */
const awayFrom = (box: Box, point: Point) =>
  Math.max(
    box.x - point.x,
    point.x - box.x - box.width,
    box.y - point.y,
    point.y - box.y - box.height,
  );

/** A source with two elements connected; as it was where the notation forbids the connection. */
function connectedOr(
  source: string,
  from: string,
  to: string,
  change: Parameters<typeof connect>[3],
): string {
  try {
    return connect(source, from, to, change);
  } catch {
    return source;
  }
}

/** A source with copies of parts of a structure, and the copies' ids. In a picture whose parts are placed, each copy stands beside its original. */
function copyParts(
  copyOf: NonNullable<Structure["copy"]>,
  source: string,
  ids: string[],
  placed: Picture | undefined,
): { source: string; made: string[] } {
  const made: string[] = [],
    taken = placed ? takenBoxes(placed) : [],
    places = new Map<string, Point>();
  let next = source;
  for (const id of ids) {
    const copy = copyOf(next, id);
    next = copy.source;
    if (!copy.id) continue;
    made.push(copy.id);
    const spot = placed && copySpot(placed, id, taken);
    if (spot) places.set(copy.id, spot);
  }
  if (!made.length) throw new Error("This part cannot be copied.");
  return { source: places.size ? setPlaces(next, places) : next, made };
}

/** Whether an element is a group that holds that many declared elements, and no more. */
function holdsOnly(diagram: TamDiagram, group: string, count: number): boolean {
  if (diagram.nodes.get(group)?.kind !== "group") return false;
  const parts = [...diagram.nodes.values()].filter(
    (node) => isDeclaredPart(node) && holder(diagram, node.id) === group,
  );
  return parts.length === count;
}

/** The box around the boxes of some elements; undefined when none is drawn. */
function boxAround(picture: Picture, ids: string[]): Box | undefined {
  const boxes = ids.flatMap((id) => boxOf(picture, id) ?? []);
  return boxes.length ? around(boxes) : undefined;
}

/** The kind of element a new connection ends at: an access at a storage, any other at an agent. */
const endKind = (change: { word: Word } | undefined): ElementKind =>
  change && /reads|writes/.test(change.word) ? "storage" : "agent";

/** The places of the parts in some lanes, moved by a step across the lanes. */
function lanesShifted(
  places: Map<string, Point>,
  parts: Map<string, StructureNode>,
  lanes: Set<string | undefined>,
  across: "x" | "y",
  step: number,
): Map<string, Point> {
  const moved = new Map<string, Point>();
  for (const [id, at] of places)
    if (lanes.has(parts.get(id)?.parent ?? undefined))
      moved.set(id, { ...at, [across]: at[across] + step });
  return moved;
}
