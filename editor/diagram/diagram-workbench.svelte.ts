// The diagram editor's window state (DiagramView.svelte and the parts of its shell: bar, rail, left panel, canvas,
// right panel, status bar): the editor of the source (diagram-editor.svelte.ts), the camera and pictures, the pointer's
// gestures, the layout, the tool, and the commands more than one part of the window runs (fit, zoom, rename, add,
// start over). Each part gets the one Workbench and reads what it shows from it.
import { applied } from "../lib/app.svelte.ts";
import { elkLayout, type Picture } from "../lib/diagrams.ts";
import { toast } from "../lib/overlays.svelte.ts";
import { paperTheme } from "../lib/paper.ts";
import type { Format } from "./diagram-export.ts";
import type { ElementKind } from "./diagram-edit.ts";
import { DiagramEditor } from "./diagram-editor.svelte.ts";
import { Gestures } from "./diagram-gestures.svelte.ts";
import { type Box, elementAt, holderAt, nameBox, type Part, type Point } from "./diagram-hit.ts";
import { dropPlace, newSpot } from "./diagram-marks.ts";
import { Layout } from "./diagram-layout.svelte.ts";
import { panTo } from "./diagram-outline.ts";
import { Camera, Pictures } from "./diagram-stage.svelte.ts";
import { type DiagramKind, type DiagramType, typeOf, typesFor } from "./diagram-types.ts";
import { detectUml } from "../../src/uml.ts";

/** The canvas's pointer tools: the rail's, and a block diagram's shape picked in the palette (a click places it). */
export type Tool = "select" | "pan" | "connect" | ElementKind;

/** What the window gets from the file view it sits in (Editor.svelte). */
export type WorkbenchHost = {
  source: () => string;
  /** The fence language the file stands for: tam or mermaid. */
  lang: () => string;
  onedit: (source: string) => void;
  onhistory: (redo: boolean) => void;
  /** Show the source at the problem's line. */
  onproblem: (line: number) => void;
  /** Open the export dialog for the picture on show, in `format` when given. */
  onexport?: (picture: Picture, format?: Format) => void;
  /** Save the file (File > Save). */
  onsave?: () => void;
};

/** The zoom steps the bar's and the status bar's zoom in and out go through (the old editor's). */
const STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

export class Workbench {
  readonly host: WorkbenchHost;
  readonly camera = new Camera();
  readonly pictures = new Pictures(() =>
    this.layout.light ? paperTheme(applied.theme) : undefined,
  );
  readonly layout = new Layout();
  readonly ed: DiagramEditor;
  readonly g: Gestures;
  stage = $state<HTMLDivElement>();
  tool = $state<Tool>("select");
  /** The shape tool stays after it placed an element, to place several (a double click on its tile); Escape ends it. */
  sticky = $state(false);
  /** A palette shape on its way to the canvas, or a shape tool over it: where it would be dropped (`at`, in the
   *  diagram) and what would hold it. The overlay draws it. */
  ghost = $state.raw<{ kind: ElementKind; at: Point; target: string | null; free?: boolean }>();
  /** Space is held: any drag pans. */
  space = $state(false);
  /** A part being named, or given another id (`reid`), in the field over the canvas. */
  renaming = $state.raw<{
    part: Part;
    value: string;
    box: Box;
    reid?: boolean;
    size: number;
    weight: number;
  }>();
  /** An element just added, renamed once its picture shows. */
  fresh: string | undefined;
  /** The New diagram chooser (DiagramChooser.svelte) is open. */
  chooser = $state(false);
  /** The sheet open over the window (DiagramHelp.svelte): Keyboard and mouse, or the syntax of the type on show. */
  sheet = $state<"help" | "syntax">();

  /** Opens the chooser of a new diagram: File > New, the bar's type chip, Ctrl+Alt+N. */
  newDiagram = () => {
    this.chooser = true;
  };
  /** Opens the Keyboard and mouse sheet, or closes it when it is open: `?`, the bar's help button. */
  toggleHelp = () => {
    this.sheet = this.sheet === "help" ? undefined : "help";
  };
  /** Opens the syntax sheet of the type on show: Help > TAM syntax. */
  showSyntax = () => {
    this.sheet = "syntax";
  };
  /** Puts `source` in place of the diagram (the chooser's Create, a guide's example), shown whole; Undo brings the
   *  one before back. */
  replace = (source: string) => {
    this.ed.start(source);
    this.camera.fitted = true;
  };

  constructor(host: WorkbenchHost) {
    this.host = host;
    this.ed = new DiagramEditor({
      source: host.source,
      picture: () => this.picture,
      broken: () => !!this.problem,
      onedit: (next) => host.onedit(next),
      edited: () => (this.camera.fitted = false),
    });
    this.g = new Gestures({
      ed: this.ed,
      camera: this.camera,
      pictures: this.pictures,
      layout: this.layout,
      stage: () => this.stage,
      lang: host.lang,
      tool: () => this.tool,
      sticky: () => this.sticky,
      select: () => this.pickTool("select"),
      space: () => this.space,
      ghost: (kind, at, free) => this.showGhost(kind as ElementKind | undefined, at, free),
      create: (kind, at, free, keep) => this.create(kind as ElementKind, at, free, keep),
      rename: (part, at) => this.startRename(part, false, at),
      placed: (id) => this.placed(id),
    });
  }

  get picture() {
    return this.pictures.picture;
  }
  get problem() {
    return this.pictures.problem;
  }
  get source() {
    return this.host.source();
  }
  get lang() {
    return this.host.lang();
  }
  /** The notation of the source on show: Mermaid where its first line names a UML type (a .tam file may hold any
   *  type), else the file's. What is edited, and how its header reads, follow it rather than the file's language. */
  get notation() {
    return detectUml(this.source) ? "mermaid" : this.lang;
  }
  /** The diagram on show, a block diagram or a UML one: what the canvas hits. */
  get model() {
    return this.ed.shown;
  }
  get empty() {
    return !this.source.trim();
  }
  /** The types the file may hold, and the one its source is. */
  get types() {
    return typesFor(this.lang);
  }
  get current() {
    return typeOf(this.pictures.kind as DiagramKind | undefined);
  }
  /** The diagram is edited as text: no structure to edit on the canvas. */
  get textual() {
    return !!this.picture && !this.model;
  }

  /** Picks a tool, as the old editor's setTool: a diagram edited as text is only panned, a UML one takes no shape
   *  tools; `sticky` keeps a shape tool for several. */
  pickTool = (tool: Tool, sticky = false) => {
    const pointer = tool === "select" || tool === "pan" || tool === "connect";
    if (tool !== "pan" && (this.textual || (!pointer && !this.ed.model))) return;
    this.tool = tool;
    this.sticky = sticky && !pointer;
    this.ghost = undefined;
  };

  /** The diagram's point under a pointer at (`clientX`, `clientY`). */
  at = (e: { clientX: number; clientY: number }) => this.camera.at(this.stage!, e);

  /** Shows the whole diagram as large as the canvas allows; an empty one at its own size, near the top left. */
  fit = () => {
    const scene = this.picture?.scene;
    if (scene?.shapes.length && scene.bounds.width) return this.camera.fit(scene.bounds);
    this.camera.view = { x: 80, y: 80, zoom: 1 };
    this.camera.fitted = true;
  };

  /** Shows the selected parts whole. */
  fitSelection = () => {
    const boxes = this.ed.selectedIds().flatMap((id) => this.ed.elementBox(id) ?? []);
    if (!boxes.length) return;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));
    this.camera.fit({ x, y, width: right - x, height: bottom - y });
    this.camera.fitted = false;
  };

  /** Brings the element `id` into view when it is outside it, by the least pan (the old view.reveal). */
  reveal = (id: string) => {
    const box = this.ed.elementBox(id);
    const { camera } = this;
    const { x, y, zoom } = camera.view;
    const margin = 24;
    const frame = {
      x: margin,
      y: margin,
      width: camera.width - 2 * margin,
      height: camera.height - 2 * margin,
    };
    const by =
      box &&
      panTo(
        {
          x: box.x * zoom + x,
          y: box.y * zoom + y,
          width: box.width * zoom,
          height: box.height * zoom,
        },
        frame,
      );
    if (by) camera.pan(camera.view, by.x, by.y);
  };

  /** Zooms to `zoom`, keeping the middle of the canvas where it is. */
  zoomTo = (zoom: number) => {
    const { camera } = this;
    camera.zoomAt(Math.min(8, Math.max(0.1, zoom)), camera.width / 2, camera.height / 2);
  };

  /** Zooms in (or out) to the next step. */
  zoomStep = (inward: boolean) => {
    const now = this.camera.view.zoom;
    const next = inward
      ? STEPS.find((s) => s > now + 0.001)
      : STEPS.findLast((s) => s < now - 0.001);
    this.zoomTo(next ?? now);
  };

  /** Opens the field that names `part` (or gives it another id) over the canvas, as the old editor's label editor:
   *  on the element (a container's title), on a connection's label, or at `at` (else the middle of its line) for one
   *  without a label. Lines of a name are typed as lines. */
  startRename = (part: Part | undefined, reid = false, at?: Point) => {
    this.fresh = undefined;
    const { model, ed } = this;
    const where = model && part && !this.problem ? nameBox(model.hits, part, at) : undefined;
    if (!where || !part) return;
    if (reid) this.renaming = { part, value: part.id.replace(/^head:/, ""), reid, ...where };
    else if (ed.nameable(part))
      this.renaming = { part, value: ed.labelOf(part).replace(/<br\s*\/?>/gi, "\n"), ...where };
  };

  endRename = (value: string | undefined) => {
    const r = this.renaming;
    this.renaming = undefined;
    this.stage?.focus();
    if (!r || value === undefined || value === r.value) return;
    if (r.reid) this.ed.umlEd.reid(r.part.id, value);
    else if (this.model) this.ed.rename(r.part, value.replace(/\n/g, "<br>"));
  };

  /** An element just added: its name opens once its picture shows. */
  placed = (id: string | undefined) => {
    if (id) this.fresh = id;
    this.stage?.focus();
  };

  /** Places a block diagram's element of `kind` centred on `at` (the old editor's create): on the grid unless `free`,
   *  in the element there; its name opens (a group's does not), and the shape tool goes unless `keep`. */
  create = (kind: ElementKind, at: Point, free = false, keep = false) => {
    const hits = this.ed.model?.hits;
    const target = hits ? elementAt(hits, at, new Set(), true) : null;
    const empty = target && !hits!.elements.some((e) => e.parent === target);
    const spot = newSpot(dropPlace(kind, at, free), empty ? this.ed.elementBox(target) : undefined);
    const id = this.ed.add(kind, at, target, spot);
    if (!id) return;
    if (!keep) this.pickTool("select");
    if (kind !== "group") this.placed(id);
    else this.stage?.focus();
  };

  /** Shows where a new element of `kind` would stand if dropped at `at`; without one, hides it. */
  showGhost = (kind?: ElementKind, at?: Point, free = false) => {
    const hits = this.ed.model?.hits;
    this.ghost =
      kind && at && hits
        ? { kind, at, target: elementAt(hits, at, new Set(), true), free }
        : undefined;
  };

  /** Adds a block diagram's element of `kind` at `p`. */
  add = (kind: ElementKind, p?: Point) => this.placed(this.ed.add(kind, p));

  /** The part a palette piece dropped at `p` would stand in or join (null: the diagram itself). */
  dropTarget(kind: string, p: Point): string | null {
    const { model, ed } = this;
    if (!model) return null;
    return ed.uml ? ed.umlEd.pieceTarget(kind, p) : holderAt(model.hits, p, new Set());
  }

  /** A palette shape dragged over the page to `client`: the part it would land in shows; dropped, it is added. */
  dragShape = (kind: string, client: Point | undefined, done: boolean) => {
    const r = this.stage!.getBoundingClientRect();
    const inside =
      client &&
      client.x >= r.left &&
      client.x <= r.right &&
      client.y >= r.top &&
      client.y <= r.bottom;
    const p = inside ? this.at({ clientX: client.x, clientY: client.y }) : undefined;
    const into = p ? this.dropTarget(kind, p) : null;
    this.g.pieceTarget = into ?? undefined;
    if (done && p) this.placed(this.ed.addPiece(kind, p, into));
  };

  /** A palette shape clicked: added at the selection, else in the middle of the view. */
  addShape = (kind: string) => {
    const r = this.stage!.getBoundingClientRect();
    const middle = this.at({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    this.placed(this.ed.addPiece(kind, this.ed.spotNear(middle)));
  };

  /** Starts over from a type's starter or one of its examples (`source`), shown whole. */
  start = (type: DiagramType, source = type.starter) => {
    if (type === this.current && !this.empty && source === type.starter) return;
    this.ed.start(source);
    this.camera.fitted = true;
  };

  undo = () => this.host.onhistory(false);
  redo = () => this.host.onhistory(true);
  exportPicture = (format?: Format) => {
    if (this.picture) this.host.onexport?.(this.picture, format);
  };
  save = () => this.host.onsave?.();
  /** Lays the whole diagram out automatically (its places dropped), and says so with a way back. */
  autoLayout = () => {
    if (this.ed.layOut())
      toast("Positions cleared. The layout is automatic.", "info", {
        label: "Undo",
        run: this.undo,
      });
  };

  /** Lays out only what is selected: the parts of the one element that holds others, or several elements among
   *  themselves (diagram-props-layout.ts); written when the source has not moved on while the layout ran. */
  layOutSelection = async () => {
    const m = this.ed.model;
    const placed = m && this.ed.edits?.placed(m);
    if (!m || !placed) return;
    const [{ laidOutWithin }, layout] = await Promise.all([
      import("./diagram-props-layout.ts"),
      elkLayout(),
    ]);
    const next = await laidOutWithin(placed, this.ed.selectedIds(), m.font, layout);
    if (this.source === m.source) this.ed.amend(() => next);
  };
}
