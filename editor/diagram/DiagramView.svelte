<!-- A diagram file (.tam, .mmd) in the diagram editor's window, as tam-diagrams' own editor laid it out: the bar
     (menus, title, type, undo, export), the tool rail, the left panel (Shapes, Outline), the canvas, the guide sheet,
     the right panel (Properties above the Source) and the status bar. The source stays the buffer's: an edit made here
     is a new source written into it as one change, so saving, undo, the dirty dot and an agent's edits work as for any
     text; the right panel's Source section shows the file's own editor (`sourcePane`, moved in while this shows).
     The parts share one Workbench (diagram-workbench.svelte.ts) and the layout it keeps (diagram-layout.svelte.ts). -->
<script lang="ts">
  import { type Snippet, untrack } from "svelte";
  import { applied } from "../lib/app.svelte.ts";
  import type { Picture } from "../lib/diagrams.ts";
  import type { Format } from "./diagram-export.ts";
  import { linesOf, partAtLine } from "./diagram-follow.ts";
  import { NARROW, RAIL } from "./diagram-layout.svelte.ts";
  import { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramBar from "./DiagramBar.svelte";
  import DiagramCanvas from "./DiagramCanvas.svelte";
  import DiagramLeft from "./DiagramLeft.svelte";
  import DiagramRail from "./DiagramRail.svelte";
  import DiagramSheets from "./DiagramSheets.svelte";
  import DiagramSide from "./DiagramSide.svelte";
  import DiagramStatus from "./DiagramStatus.svelte";

  type Props = {
    source: string;
    /** The fence language the file stands for: tam or mermaid. */
    lang: string;
    onedit: (source: string) => void;
    onhistory: (redo: boolean) => void;
    /** Show the source at the problem's line. */
    onproblem: (line: number) => void;
    /** The line the person put the cursor on in the source: what it declares gets selected. */
    cursor?: { line: number };
    /** The source lines of what is selected, as the selection or the diagram changes. */
    onlines?: (lines: number[]) => void;
    /** Open or close the syntax guide; "all": open it on the list of all guides. */
    onguide?: (page?: "all") => void;
    /** The guide sheet while it is open, docked between the canvas and the right panel; it may show the source (to
     *  write a row into it) and put an example in place of the diagram. */
    guide?: Snippet<[{ showSource: () => void; replace: (source: string) => void }]>;
    /** Open the export dialog for the picture on show, in `format` when given. */
    onexport?: (picture: Picture, format?: Format) => void;
    /** Save the file (File > Save). */
    onsave?: () => void;
    /** The file's source editor, shown in the right panel's Source section. */
    sourcePane?: HTMLElement;
    canUndo?: boolean;
    canRedo?: boolean;
    dirty?: boolean;
  };
  let {
    source,
    lang,
    onedit,
    onhistory,
    onproblem,
    cursor,
    onlines,
    onguide,
    guide,
    onexport,
    onsave,
    sourcePane,
    canUndo,
    canRedo,
    dirty,
  }: Props = $props();

  const ws = new Workbench({
    source: () => source,
    lang: () => lang,
    onedit: (next) => onedit(next),
    onhistory: (redo) => onhistory(redo),
    onproblem: (line) => {
      ws.layout.side = ws.layout.source = true;
      onproblem(line);
    },
    onexport: (picture, format) => onexport?.(picture, format),
    onsave: () => onsave?.(),
  });
  const { layout } = ws;

  // The source is drawn as it changes, in the theme's colors or on the light canvas; a source that does not read keeps
  // the last picture.
  $effect(() => {
    void [applied.theme, layout.light];
    ws.pictures.show(source, lang);
  });
  $effect(() => {
    ws.ed.load(ws.notation);
  });
  $effect(() => {
    void ws.picture;
    untrack(() => {
      if (!ws.g.active) ws.g.endDrag();
      const box = ws.fresh && ws.ed.elementBox(ws.fresh);
      if (box && ws.fresh) ws.startRename({ type: "element", id: ws.fresh });
    });
  });

  // The source and the picture follow each other: the cursor's line selects what it declares, and the selection's
  // lines are marked in the source.
  $effect(() => {
    const line = cursor?.line;
    const part = line && untrack(() => partAtLine(ws.ed.lined, line));
    if (part) ws.ed.selection = [part];
  });
  $effect(() => onlines?.(linesOf(ws.ed.lined, ws.ed.selection)));

  $effect(() => {
    void [ws.camera.width, ws.camera.height, ws.picture];
    if (ws.camera.fitted) untrack(ws.fit);
  });

  const left = $derived(layout.left && !ws.empty ? layout.left : undefined);
  const side = $derived(layout.side);
</script>

<div
  class="shell"
  class:left-over={layout.narrow}
  class:side-over={layout.tiny}
  class:guide-open={!!guide}
  bind:clientWidth={layout.width}
  style:--left="{left && !layout.narrow ? layout.leftWidth : 0}px"
  style:--right="{side && !layout.tiny ? layout.rightWidth : 0}px"
  style:--rail="{RAIL}px"
>
  <DiagramBar {ws} {canUndo} {canRedo} {dirty} {onguide} />
  <DiagramRail {ws} />
  {#if left}<DiagramLeft {ws} tab={left} over={layout.width < NARROW} />{/if}
  <DiagramCanvas {ws} />
  {#if guide}
    <div class="guide">
      {@render guide({
        showSource: () => (layout.side = layout.source = true),
        replace: ws.replace,
      })}
    </div>
  {/if}
  {#if side}<DiagramSide
      {ws}
      {sourcePane}
      over={layout.tiny}
      onguide={onguide && (() => onguide())}
    />{/if}
  <DiagramStatus {ws} />
  <DiagramSheets {ws} {dirty} />
</div>

<style>
  /* The editor's palette, the app's own colors: the parts read these. The light canvas (DiagramCanvas.svelte) sets the
     page's variables to the paper's, and takes this palette again so what is drawn on it reads them. */
  .shell,
  .shell :global(.paper) {
    --d-panel: var(--c-surface);
    --d-panel-2: var(--c-surface);
    --d-field: var(--c-canvas);
    --d-raised: var(--c-popover);
    --d-line: var(--c-border);
    --d-line-strong: var(--c-input);
    --d-text: var(--c-foreground);
    --d-text-2: var(--c-muted);
    --d-text-3: var(--c-dim);
    --d-hover: var(--c-hover);
    --d-active: var(--c-selected);
    --d-accent: var(--c-accent);
    --d-accent-soft: var(--c-accent-soft);
    --d-accent-text: var(--c-accent);
    --d-danger: var(--c-danger);
    --d-warning: var(--ansi-3);
    --d-warning-soft: color-mix(in srgb, var(--ansi-3) 14%, transparent);
    --d-control: var(--control-md);
  }
  .shell {
    position: relative;
    display: grid;
    grid-template:
      "bar bar bar bar" var(--bar-height)
      "rail left stage side" minmax(0, 1fr)
      "status status status status" var(--control-sm)
      / var(--rail) var(--left) minmax(0, 1fr) var(--right);
    height: 100%;
    overflow: hidden;
    background: var(--d-panel);
    color: var(--d-text);
    font-size: var(--text-sm);
    user-select: none;
  }
  /* A text field of the editor's parts (the left panel's searches, the Properties' fields), as the app's .input. */
  .shell :global(.field) {
    width: 100%;
    min-width: 0;
    height: var(--d-control);
    padding: 0 var(--space-4);
    border: var(--border-width) solid var(--d-line-strong);
    border-radius: var(--radius-md);
    background: var(--d-field);
    color: var(--d-text);
    font: inherit;
  }
  .shell :global(.field::placeholder) {
    color: var(--d-text-3);
  }
  .shell :global(.field:focus) {
    outline: none;
    border-color: var(--d-accent);
  }
  /* The guide sheet, between the canvas and the right panel: it takes its room from the canvas while that keeps
     320px, and lies over the canvas in a small window. */
  .guide {
    z-index: 7;
    grid-area: stage;
    justify-self: end;
    display: flex;
    width: min(440px, 100%);
    min-height: 0;
  }
  .guide-open > :global(.canvas) {
    margin-right: clamp(0px, calc(100% - 320px), 440px);
  }
</style>
