// The diagram editor's state and commands (DiagramView.svelte keeps the picture and the pointer): the model of the
// block diagram on show, the selection, and what can be done to it: add, rename, delete, nudge, align and size,
// copy and paste, duplicate, group, lay out again, and a type's starter or statements. Every edit is a whole new
// source handed to `onedit`, which writes it into the buffer as one change (undo, save and the dirty dot as for text).
import { colors, type Picture } from "../lib/diagrams.ts";
import { toast } from "../lib/overlays.svelte.ts";
import { errorText } from "../shared/errors.ts";
import { type Arrangement, around, encloses } from "./diagram-arrange.ts";
import type * as Edit from "./diagram-edit.ts";
import { type Box, holderAt, middle, overlap, type Part, type Point } from "./diagram-hit.ts";
import { partTree, tamTree, type TreeItem } from "./diagram-outline.ts";
import type { Port } from "./diagram-ports.ts";
import { withSnippet } from "./diagram-types.ts";
import { UmlEditor } from "./diagram-uml-editor.svelte.ts";
import { type Palette, paletteOf, wordingOf } from "./palettes.ts";

type Host = {
  source: () => string;
  picture: () => Picture | undefined;
  /** The newest source does not read. */
  broken: () => boolean;
  onedit: (source: string) => void;
  /** An edit was made: the view stops keeping the diagram fitted. */
  edited: () => void;
};

export class DiagramEditor {
  edits = $state.raw<typeof Edit>();
  selection = $state.raw<Part[]>([]);
  /** The palette's kind of connection new connections are drawn as; undefined: what fits the two elements. */
  link = $state<string>();
  #host: Host;
  /** Where the last paste landed. */
  #pastedAt: Point | undefined;
  /** The block diagram on show, when the picture is of the current source and it reads; else undefined. */
  model = $derived.by(() => {
    const { edits } = this;
    const source = this.#host.source();
    const picture = this.#host.picture();
    return edits && picture?.source === source && !this.#host.broken()
      ? edits.modelOf(source, picture.scene, colors().font)
      : undefined;
  });
  /** The parts and joins on show with their source lines, which the source and the picture follow each other by. */
  lined = $derived((this.model && this.edits?.linedOf(this.model)) ?? this.uml);

  /** The commands on a Mermaid UML diagram, which those here hand on to while one is on show (`uml`). */
  umlEd: UmlEditor;

  constructor(host: Host) {
    this.#host = host;
    const write = (source: string) => this.#write(source);
    this.umlEd = new UmlEditor({
      ...host,
      write,
      selection: () => this.selection,
      select: (parts) => (this.selection = parts),
    });
  }

  /** The UML diagram on show, edited by its structure; undefined for a block diagram. */
  get uml() {
    return this.umlEd.model;
  }

  /** The diagram on show, either notation: what the canvas hits. */
  get shown() {
    return this.model ?? this.uml;
  }

  /** Makes an edit of the UML diagram on show (the Properties' fields): see UmlEditor.apply. */
  applyUml: UmlEditor["apply"] = (make) => this.umlEd.apply(make);

  /** The palette of the diagram on show: its shapes and kinds of connection. */
  get palette(): Palette | undefined {
    return this.uml ? (this.umlEd.palette ?? undefined) : this.model && paletteOf("tam");
  }

  /** Loads the edits of a fence language's diagrams (tam or mermaid), once. */
  load(lang = "tam") {
    if (lang !== "tam") this.umlEd.load();
    else if (!this.edits) void import("./diagram-edit.ts").then((module) => (this.edits = module));
  }

  elementBox = (id: string) => this.shown?.hits.elements.find((e) => e.id === id)?.box;
  selectedIds = () => this.selection.filter((p) => p.type === "element").map((p) => p.id);
  isSelected = (part: Part) => this.selection.some((p) => p.type === part.type && p.id === part.id);

  /** Makes an edit of the block diagram: its source goes into the buffer, or the notation's refusal shows. */
  apply(make: (m: Edit.Model, edits: typeof Edit) => string): boolean {
    const { edits, model } = this;
    if (!edits || !model) return false;
    const result = edits.attempt(() => make(model, edits));
    if ("refused" in result) {
      toast(result.refused, "error");
      return false;
    }
    this.#write(result.source);
    return true;
  }

  #write(source: string) {
    this.#host.edited();
    if (source !== this.#host.source()) this.#host.onedit(source);
  }

  /** Runs an edit that makes elements and selects them; false when it was refused. */
  #making(
    make: (m: Edit.Model, edits: typeof Edit) => { source: string; ids: string[] } | undefined,
  ): boolean {
    let ids: string[] = [];
    const done = this.apply((m, edits) => {
      const made = make(m, edits);
      if (!made) throw new Error("The clipboard holds no elements");
      ids = made.ids;
      return made.source;
    });
    if (done) this.selection = ids.map((id) => ({ type: "element", id }));
    return done;
  }

  /** Adds an element of `kind` at `p` (or where the layout puts it), into `target` (else what holds `p`; null: the
   *  diagram itself), its top left at `corner` when given; the id it got, when made. */
  add(
    kind: Edit.ElementKind,
    p?: Point,
    target?: string | null,
    corner = p && { x: p.x - 40, y: p.y - 16 },
  ): string | undefined {
    let id = "";
    const made = this.#making((m, edits) => {
      const into = target !== undefined ? target : p ? holderAt(m.hits, p, new Set()) : null;
      const result = edits.added(m, kind, corner, into);
      id = result.id;
      return { source: result.source, ids: [result.id] };
    });
    return made ? id : undefined;
  }

  remove = () => {
    const parts = this.selection;
    const done =
      parts.length &&
      (this.uml ? this.umlEd.remove(parts) : this.apply((m, edits) => edits.removed(m, parts)));
    if (done) this.selection = [];
  };

  nudge(dx: number, dy: number) {
    const ids = this.selectedIds();
    if (this.uml) this.umlEd.nudge({ x: dx, y: dy });
    else if (ids.length) this.apply((m, edits) => edits.moved(m, ids, { x: dx, y: dy }));
  }

  /** The source a drag of the selection by `delta` makes, or a resize of the one selected element to `box`. */
  drafted(delta: Point, box?: Box): string | undefined {
    const { edits, model } = this;
    const ids = this.selectedIds();
    if (this.uml) return box ? undefined : this.umlEd.drafted(delta);
    if (!edits || !model || !ids[0]) return undefined;
    const made = edits.attempt(() =>
      box ? edits.resized(model, ids[0]!, box) : edits.moved(model, ids, delta),
    );
    return "source" in made ? made.source : undefined;
  }

  /** Ends a drag of the selection by `delta`: moved, into what it was dropped on. */
  drop(delta: Point): boolean {
    const ids = this.selectedIds();
    if (this.uml) return this.umlEd.drop(delta);
    return (
      ids.length > 0 &&
      this.apply((m, edits) => edits.moved(m, ids, delta, edits.dropHolder(m, ids, delta)))
    );
  }

  /** Says that the parts of a UML diagram size themselves; true for a block diagram. */
  #sized = () => !this.uml || (toast("The parts of this diagram size themselves.", "info"), false);

  arrange = (how: Arrangement) =>
    this.uml
      ? this.umlEd.arrange(how)
      : this.apply((m, edits) => edits.arranged(m, this.selectedIds(), how));
  sameSize = (side: "width" | "height") =>
    this.#sized() && this.apply((m, edits) => edits.sameSize(m, this.selectedIds(), side));
  fitSize = () => this.#sized() && this.apply((m, edits) => edits.fitted(m, this.selectedIds()));
  layOut = () => (this.uml ? this.umlEd.layOut() : this.apply((m, edits) => edits.laidOut(m)));
  duplicate = () =>
    this.selectedIds().length > 0 &&
    (this.uml
      ? !!this.umlEd.duplicate()
      : this.#making((m, edits) => edits.duplicated(m, this.selectedIds())));
  group = () =>
    this.selectedIds().length > 0 &&
    this.#sized() &&
    this.#making((m, edits) => {
      const made = edits.grouped(m, this.selectedIds());
      return { source: made.source, ids: [made.id] };
    });

  selectAll = () => {
    const ids = new Set((this.shown?.hits.elements ?? []).map((e) => e.id));
    this.selection = [...ids].map((id) => ({ type: "element", id }));
  };

  /** The selected elements as text, for the clipboard; undefined when nothing is selected. */
  copy(): string | undefined {
    const { edits, model } = this;
    const ids = this.selectedIds();
    return edits && model && ids.length ? edits.copied(model, ids) : undefined;
  }

  /** Adds the elements of copied `text`, at `at` when given, and selects them. */
  paste = (text: string, at?: Point) => this.#making((m, edits) => edits.pasted(m, text, at));

  /** Where elements lie on each other in the picture, which the notation does not allow: the boxes they share. */
  overlaps = $derived.by((): Box[] => {
    const { edits, model } = this;
    if (!edits || !model) return [];
    return edits.overlaps(model).flatMap(([a, b]) => {
      const [first, second] = [this.elementBox(a), this.elementBox(b)];
      const shared = first && second && overlap(first, second);
      return shared ? [shared] : [];
    });
  });

  /** The diagram's elements as the outline's tree, each under what holds it: a block diagram's, or a UML one's parts. */
  tree = $derived.by((): TreeItem[] => {
    const shown = this.shown;
    if (!shown) return [];
    const drawn = new Set(shown.hits.elements.map((e) => e.id));
    if (this.model)
      return tamTree(this.model.diagram.nodes, this.model.diagram.roots, (id) => drawn.has(id));
    return partTree(this.uml?.nodes ?? [], (id) => drawn.has(id));
  });

  /** Puts the elements `ids` into `target` (null: the diagram itself): a block diagram's in a row below what it holds,
   *  a UML diagram's parts into a group of its structure, where it takes them. */
  nest = (ids: string[], target: string | null) => {
    const done = this.uml
      ? this.umlEd.apply((m) => {
          const moved = ids.reduce(
            (source, id) => m.structure.moveInto?.(source, id, target) ?? source,
            m.source,
          );
          if (moved === m.source) throw new Error("This part cannot stand there.");
          return moved;
        })
      : this.apply((m, edits) => edits.nested(m, ids, target));
    if (done) this.selection = ids.map((id) => ({ type: "element", id }));
  };

  /** Whether the elements `ids` may go into `target` (null: the diagram): never into themselves; a block diagram's
   *  where the notation takes them there, a UML part only into a group, where its structure moves parts. */
  allowsMove(ids: string[], target: string | null): boolean {
    if (target !== null && ids.includes(target)) return false;
    const { edits, model } = this;
    if (edits && model) return "source" in edits.attempt(() => edits.nested(model, ids, target));
    if (!this.uml) return false;
    return (
      !!this.uml.structure.moveInto && (target === null || !!this.uml.parts.get(target)?.group)
    );
  }

  /** Where a shape added by a click goes: in the middle of the one selected element that holds others, beside the
   *  selection, else at `fallback` (the middle of the view). */
  spotNear(fallback: Point): Point {
    const boxes = this.selectedIds().flatMap(
      (id) => this.shown?.hits.elements.find((e) => e.id === id) ?? [],
    );
    if (!boxes.length) return fallback;
    if (boxes.length === 1 && boxes[0]!.holder) return middle(boxes[0]!.box);
    const all = around(boxes.map((e) => e.box));
    return { x: all.x + all.width + 80, y: all.y + all.height / 2 };
  }

  /** Adds a palette shape: at `at`, into `target` when given, else into the one selected element that holds others. */
  addPiece(kind: string, at?: Point, target?: string | null): string | undefined {
    if (this.uml) return this.umlEd.addPiece(kind, at, target);
    const { edits, model } = this;
    if (!edits || !model || !(edits.KINDS as readonly string[]).includes(kind)) return undefined;
    const [only] = this.selectedIds();
    const holder =
      this.selectedIds().length === 1 && model.hits.elements.find((e) => e.id === only)?.holder
        ? only
        : undefined;
    return this.add(kind as Edit.ElementKind, at, target === undefined ? holder : target);
  }

  /** Picks a palette kind of connection: new connections are drawn as it, and the selected ones become it. Picking it
   *  again goes back to drawing what fits the two elements. */
  pickLink(kind: string) {
    if (this.uml) return this.umlEd.pickLink(kind);
    this.link = this.link === kind ? undefined : kind;
    const wording = this.link && wordingOf(this.link);
    const wires = this.selection.filter((part) => part.type === "wire").map((part) => part.id);
    if (wording && wires.length)
      this.apply((m, edits) =>
        wires.reduce((source, id) => edits.relinked({ ...m, source }, id, wording), m.source),
      );
  }

  /** Connects two elements as the picked kind where it fits, else as what fits them (saying why), and selects it. */
  /** Connects two elements; `ports` are the ports chosen for their ends, by element (diagram-ports.ts): a block
   *  diagram then places every element, which the ports are for. */
  connect(from: string, to: string, ports: ReadonlyMap<string, Port> = new Map()) {
    if (this.uml) return this.umlEd.connect(from, to);
    const asked = this.link ? wordingOf(this.link) : undefined;
    let replaced: string | undefined;
    let written = "";
    const done = this.apply((m, edits) => {
      const made = edits.connected(
        ports.size ? { ...m, source: edits.placed(m) } : m,
        from,
        to,
        asked,
      );
      replaced = made.replaced;
      const edge = ports.size ? edits.lastEdge(made.source) : undefined;
      return (written = edge ? edits.ported(made.source, edge, ports) : made.source);
    });
    const edge = done && this.edits?.lastEdge(written);
    if (edge) this.selection = [{ type: "wire", id: edge }];
    if (replaced) toast(replaced, "info");
  }

  reverse = (id: string) =>
    this.uml ? this.umlEd.reverse(id) : this.apply((m, edits) => edits.reversed(m, id));
  rekind = (id: string, kind: Edit.ElementKind) =>
    this.apply((m, edits) => edits.rekinded(m, id, kind));
  labelOf = (part: Part) =>
    (this.uml ? this.umlEd.labelOf(part) : this.model && this.edits?.labelOf(this.model, part)) ??
    "";
  /** Whether a part carries a name to type: a UML start or fork does not, nor a join whose text is its kind. */
  nameable = (part: Part) => !this.uml || this.umlEd.nameable(part);
  rename = (part: Part, label: string) =>
    this.uml
      ? this.umlEd.rename(part, label)
      : label !== this.labelOf(part) && this.apply((m, edits) => edits.renamed(m, part, label));

  /** Starts over from a type's starter source. */
  start(starter: string) {
    this.selection = [];
    this.#write(starter);
  }

  /** Adds statements at the end of the source (a UML diagram's Add menu). */
  addStatements = (text: string) => this.#write(withSnippet(this.#host.source(), text));

  /** Makes an edit of the source as it is, whatever its notation (the Properties' diagram settings): written as one
   *  change, or the reason `make` throws shows. */
  amend(make: (source: string, picture: Picture | undefined) => string): boolean {
    let source: string;
    try {
      source = make(this.#host.source(), this.#host.picture());
    } catch (error) {
      toast(errorText(error).replace(/^Line \d+: /, ""), "error");
      return false;
    }
    this.#write(source);
    return true;
  }

  /** Selects what `band` encloses, besides the parts `kept`. */
  selectBand(kept: Part[], band: Box) {
    const inside = (this.shown?.hits.elements ?? []).filter(
      (e) => encloses(band, e.box) && !kept.some((k) => k.id === e.id),
    );
    this.selection = [
      ...kept,
      ...[...new Set(inside.map((e) => e.id))].map((id): Part => ({ type: "element", id })),
    ];
  }

  /** Copy or cut: the selected elements go on the clipboard as source text. */
  copyTo(e: ClipboardEvent, cut: boolean) {
    const text = this.copy();
    if (!text) return;
    e.clipboardData?.setData("text/plain", text);
    e.preventDefault();
    if (cut) this.remove();
  }

  /** Paste: lands under the `pointer`, unless it has not moved since the last paste, then beside what was pasted. */
  pasteFrom(e: ClipboardEvent, pointer: Point | undefined) {
    const text = this.model ? e.clipboardData?.getData("text/plain") : undefined;
    if (!text) return;
    e.preventDefault();
    const last = this.#pastedAt;
    this.#pastedAt = pointer;
    this.paste(
      text,
      pointer && (pointer.x !== last?.x || pointer.y !== last?.y) ? pointer : undefined,
    );
  }

  /** The boxes a dragged selection lines up with: every element but the selected and what they hold. */
  snapTargets(): Box[] {
    const chosen = new Set(this.selectedIds());
    return this.#elements()
      .filter((e) => !this.#within(e.id, chosen))
      .map((e) => e.box);
  }

  /** The boxes of the selected elements that no other selected one holds: what a drag moves. */
  movingBoxes(): Box[] {
    const chosen = new Set(this.selectedIds());
    return this.#elements()
      .filter((e) => chosen.has(e.id) && !this.#within(e.parent, chosen))
      .map((e) => e.box);
  }

  #elements = () => this.shown?.hits.elements ?? [];

  /** Whether the element `id` is one of `chosen` or held by one of them, at any depth. */
  #within(id: string | null | undefined, chosen: Set<string>): boolean {
    const parents = new Map(this.#elements().map((e) => [e.id, e.parent]));
    for (let at = id, steps = 0; at && steps <= parents.size; at = parents.get(at), steps++)
      if (chosen.has(at)) return true;
    return false;
  }
}
