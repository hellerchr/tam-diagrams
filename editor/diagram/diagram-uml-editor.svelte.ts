// The diagram editor's commands on a Mermaid UML diagram (diagram-editor.svelte.ts hands them on): the model of the
// diagram on show, by the structure of its type, and adding a piece, joining two parts with the kind of join picked,
// naming, removing, moving (into groups; a sequence diagram's participants and messages change their order),
// arranging, duplicating, ungrouping and the rest. Every edit is a whole new source, as for a block diagram; a refused
// one says why.
import { colors, type Picture } from "../lib/diagrams.ts";
import { toast } from "../lib/overlays.svelte.ts";
import type { Arrangement } from "./diagram-arrange.ts";
import type { Part, Point } from "./diagram-hit.ts";
import { laneBorderAt } from "./diagram-uml-hits.ts";
import type { uml as Uml } from "./diagram-uml.ts";
import type { UmlModel } from "./diagram-uml-model.ts";

type Edits = typeof Uml;
type Host = {
  source: () => string;
  picture: () => Picture | undefined;
  broken: () => boolean;
  write: (source: string) => void;
  selection: () => Part[];
  select: (parts: Part[]) => void;
};

export class UmlEditor {
  edits = $state.raw<Edits>();
  /** The kind of join picked in the palette; the type's usual one until another is. */
  picked = $state<string>();
  #host: Host;
  /** A part just added: its first name may become its id. */
  #fresh: string | undefined;
  /** The UML diagram on show, when its type has a structure, the picture is of the current source and it reads. */
  model = $derived.by(() => {
    const { edits } = this;
    const source = this.#host.source();
    const picture = this.#host.picture();
    return edits && picture?.source === source && !this.#host.broken()
      ? edits.modelOf(source, picture.scene, colors().font)
      : undefined;
  });

  constructor(host: Host) {
    this.#host = host;
  }

  /** Loads the edits of UML diagrams, once. */
  load() {
    if (!this.edits) void import("./diagram-uml.ts").then((module) => (this.edits = module.uml));
  }

  /** The palette of the type on show: its pieces and kinds of join. */
  palette = $derived(this.model && this.edits?.palette(this.model.kind));

  /** The kind of join new joins are drawn with. */
  get link(): string | undefined {
    const links = this.model?.structure.links ?? [];
    return links.some((l) => l.kind === this.picked) ? this.picked : links[0]?.kind;
  }

  /** Makes an edit of the UML diagram: its source goes into the buffer, or the refusal shows. */
  apply(make: (m: UmlModel, edits: Edits) => string): boolean {
    const { edits, model } = this;
    if (!edits || !model) return false;
    const result = edits.attempt(() => make(model, edits));
    if ("refused" in result) {
      toast(result.refused, "error");
      return false;
    }
    this.#host.write(result.source);
    return true;
  }

  /** Runs an edit that makes parts or a join and selects them. */
  #making(
    type: Part["type"],
    make: (m: UmlModel, edits: Edits) => { source: string; ids: string[] },
  ): string[] | undefined {
    let ids: string[] = [];
    const done = this.apply((m, edits) => {
      const made = make(m, edits);
      ids = made.ids;
      return made.source;
    });
    if (done) this.#host.select(ids.map((id) => ({ type, id })));
    return done ? ids : undefined;
  }

  #elements = () =>
    this.#host
      .selection()
      .filter((p) => p.type === "element")
      .map((p) => p.id);
  #wires = () =>
    this.#host
      .selection()
      .filter((p) => p.type === "wire")
      .map((p) => p.id);

  /** Adds a piece: at the part `target` (null: alone; undefined: the one selected part, or a sequence diagram's
   *  message), around `at`. The id it got. */
  addPiece(kind: string, at?: Point, target?: string | null): string | undefined {
    const [only, ...more] = this.#host.selection();
    const selected = more.length ? undefined : only?.id;
    const ids = this.#making("element", (m, edits) => {
      const made = edits.added(m, kind, { at, target, selected });
      return { source: made.source, ids: [made.id] };
    });
    this.#fresh = ids?.[0];
    return ids?.[0];
  }

  /** The part a piece dropped at `at` would stand in or be joined to (null: none). */
  pieceTarget = (kind: string, at: Point) =>
    (this.model && this.edits?.pieceTarget(this.model, kind, at)) ?? null;

  /** Picks the kind of join new joins are drawn with; the selected joins become it. */
  pickLink(kind: string) {
    this.picked = kind;
    const wires = this.#wires();
    if (wires.length) this.apply((m, edits) => edits.relinked(m, wires, kind));
  }

  /** Joins two parts with the kind picked, after the one selected join where joins are ordered; selects the join. */
  connect(from: string, to: string) {
    const [only, ...more] = this.#host.selection();
    const after = !more.length && only?.type === "wire" ? only.id : undefined;
    this.#making("wire", (m, edits) => {
      const made = edits.connected(m, from, to, { kind: this.link, after });
      return { source: made.source, ids: made.edge ? [made.edge] : [] };
    });
  }

  remove = (parts: Part[]) => this.apply((m, edits) => edits.removed(m, parts));
  labelOf = (part: Part) => (this.model && this.edits?.labelOf(this.model, part)) ?? "";
  nameable = (part: Part) => !!this.model && !!this.edits?.named(this.model, part);

  /** Names a part or labels a join; a part just added takes its id from its first name where the syntax allows. */
  rename(part: Part, label: string) {
    const fresh = this.#fresh === part.id;
    this.#fresh = undefined;
    if (label === this.labelOf(part)) return;
    let id = part.id;
    const done = this.apply((m, edits) => {
      const made = edits.renamed(m, part, label, fresh);
      id = made.id;
      return made.source;
    });
    if (done && id !== part.id) this.#host.select([{ ...part, id }]);
  }

  /** The source a drag of the selection by `delta` makes: parts moved, or a sequence diagram's message moved along. */
  drafted(delta: Point): string | undefined {
    const { edits, model } = this;
    if (!edits || !model) return undefined;
    const made = edits.attempt(() => this.#moved(model, edits, delta, false));
    return "source" in made ? made.source : undefined;
  }

  /** Ends a drag of the selection by `delta`: moved, and into the group it was dropped on. */
  drop = (delta: Point) => this.apply((m, edits) => this.#moved(m, edits, delta, true));

  #moved(m: UmlModel, edits: Edits, delta: Point, dropped: boolean): string {
    const ids = this.#elements();
    const [wire] = this.#wires();
    if (!ids.length && wire && m.kind === "sequence")
      return edits.messageMoved(m, wire, delta.y).source;
    return edits.moved(m, ids, delta, dropped ? edits.dropHolder(m, ids, delta) : undefined);
  }

  /** The arrow keys: parts move by `delta`; a sequence diagram's participant a column, a message a step. */
  nudge(delta: Point) {
    const [only, ...more] = this.#host.selection();
    if (
      this.model?.kind === "sequence" &&
      only &&
      !more.length &&
      !this.edits?.placed(this.model)
    ) {
      const step = (delta.x || delta.y) < 0 ? -1 : 1;
      if (only.type === "element" ? delta.x : delta.y)
        this.apply((m, edits) => edits.stepped(m, only, step));
      return;
    }
    const ids = this.#elements();
    if (ids.length) this.apply((m, edits) => edits.moved(m, ids, delta));
  }

  arrange = (how: Arrangement) =>
    this.apply((m, edits) => edits.arranged(m, this.#elements(), how));
  layOut = () => this.apply((m, edits) => edits.laidOut(m));
  duplicate = () => this.#making("element", (m, edits) => edits.duplicated(m, this.#elements()));
  reverse = (id: string) => this.apply((m, edits) => edits.reversed(m, id));
  relink = (id: string, kind: string) => this.apply((m, edits) => edits.relinked(m, [id], kind));
  linkKind = (id: string) => this.model?.joins.get(id)?.kind;
  ungroup = (id: string) =>
    this.apply((m, edits) => edits.ungrouped(m, id)) && this.#host.select([]);
  reid = (id: string, next: string) =>
    this.#making("element", (m, edits) => {
      const made = edits.reided(m, id, next);
      return { source: made.source, ids: [made.id] };
    });
  can = (edit: "reverse" | "copy" | "moveInto" | "ungroup" | "reid") =>
    !!this.model && !!this.edits?.can(this.model, edit);

  /** The lane of an activity with lanes whose far border lies within `reach` of `p`. */
  laneBorder = (p: Point, reach: number) =>
    this.model?.lanes ? laneBorderAt(this.model.lanes, p, reach) : undefined;

  /** Gives the lane at `index` of an activity with lanes the width `width`; the source it makes, written when `done`. */
  laneSized(index: number, width: number, done: boolean): string | undefined {
    const { edits, model } = this;
    if (!edits || !model) return undefined;
    const source = edits.laneSized(model, index, width);
    if (done) this.#host.write(source);
    return source;
  }
}
