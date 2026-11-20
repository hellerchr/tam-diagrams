<!-- The diagram editor's canvas (DiagramView.svelte), as tam-diagrams' old editor had it: the page in the diagram's
     color (white while the canvas is light) with its dot grid, the picture, what the editor draws over it (DiagramOverlay.svelte), the field that renames
     a part, the word of an empty diagram, the banner of a source that does not read (the last good picture dimmed
     under it), the way back to a diagram the view has left, and the minimap. The pointer is the gestures'
     (diagram-gestures.svelte.ts): the rail's tool, Space or the middle button pans, the wheel pans, Ctrl+wheel or a
     pinch zooms; a press selects, a drag moves, resizes, connects or selects with a band; a double click renames or
     adds; a right press opens the menu of what it is on. -->
<script lang="ts">
  import { untrack } from "svelte";
  import { applied } from "../lib/app.svelte.ts";
  import { paperTheme, paperVars } from "../lib/paper.ts";
  import Icon from "../ui/Icon.svelte";
  import { gridBox, gridPlace, gridStale, gridTile } from "./diagram-grid.ts";
  import { drawnAt, type Part } from "./diagram-hit.ts";
  import { ICONS } from "./diagram-icons.ts";
  import { canvasHasKey, diagramKeys, escape } from "./diagram-keys.ts";
  import { awayFromView, boxOnScreen, toScreen } from "./diagram-marks.ts";
  import { openContextMenu } from "./diagram-menus.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramMinimap from "./DiagramMinimap.svelte";
  import DiagramOverlay from "./DiagramOverlay.svelte";
  import DiagramRename from "./DiagramRename.svelte";

  let { ws }: { ws: Workbench } = $props();
  const ed = $derived(ws.ed);
  const g = $derived(ws.g);
  const camera = $derived(ws.camera);
  const view = $derived(camera.view);
  const shown = $derived(ws.pictures.preview ?? ws.picture);

  /** A right press selects what it is on (unless that is selected already; on nothing, nothing) and opens its menu
   *  (on the context menu event, which follows the press, so the menu's own catcher does not take it). */
  function pressMenu(e: MouseEvent) {
    e.preventDefault();
    if (g.active) return;
    const p = ws.at(e);
    const part = g.partAt(p);
    if (!part) ed.selection = [];
    else if (!ed.isSelected(part)) ed.selection = [part];
    openContextMenu(ws, e, p);
  }

  /** A double click with the select tool: on nothing it adds (an agent, or the type's first piece), on a part it
   *  opens its name, on a connection its label at the pointer. */
  function dblclick(e: MouseEvent) {
    if (ws.tool !== "select" || !ws.model) return;
    const p = ws.at(e);
    const part: Part | undefined = g.partAt(p);
    if (part) return ws.startRename(part, false, part.type === "wire" ? p : undefined);
    if (!ed.uml) return ws.create("agent", p, e.altKey);
    const kind = ed.palette?.shapes[0]?.kind;
    if (kind && shown && !drawnAt(shown.scene, p))
      ws.placed(ed.addPiece(kind, p, ed.umlEd.pieceTarget(kind, p)));
  }

  const keyRun = $derived(diagramKeys(ws));
  /** The canvas's keys reach it wherever the focus is in the diagram's window, as the old editor's did. */
  function key(e: KeyboardEvent) {
    if (
      e.defaultPrevented ||
      !ws.stage?.isConnected ||
      !canvasHasKey(e, ws.stage.closest(".shell"))
    )
      return;
    if (e.key === " " && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      ws.space = true;
      return g.refreshCursor();
    }
    const run = keyRun(e);
    if (!run) return;
    e.preventDefault();
    run(e);
  }
  /** Escape is the diagram's wherever the focus is in its window: taken before the app's own (which would stop the
   *  session's agent and go to the message box), it ends a gesture, else the tool, else the selection. */
  function escapeKey(e: KeyboardEvent) {
    if (e.key !== "Escape" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (
      e.defaultPrevented ||
      !ws.stage?.isConnected ||
      !canvasHasKey(e, ws.stage.closest(".shell"))
    )
      return;
    e.preventDefault();
    escape(ws);
  }
  function release(e: KeyboardEvent) {
    if (e.key !== " ") return;
    ws.space = false;
    g.refreshCursor();
  }

  // Copy, cut and paste reach the canvas when it has the focus: the selected elements travel as source text.
  const focused = () => !!ws.stage && document.activeElement === ws.stage;

  /** How long the view stays before the picture and the grid are drawn again at its zoom. */
  const SETTLE_MS = 150;

  /** Follows the view's zoom into what `get` reads and `set` writes once the zoom has stayed SETTLE_MS (at once the
   *  first time). */
  function settleZoom(get: () => number | undefined, set: (zoom: number) => void) {
    $effect(() => {
      const zoom = view.zoom;
      if (untrack(get) === undefined) return void set(zoom);
      const timer = setTimeout(() => set(zoom), SETTLE_MS);
      return () => clearTimeout(timer);
    });
  }

  /** A light canvas wears the paper's colors (lib/paper.ts) as the page's variables, for what is drawn on it too. */
  const paper = $derived(ws.layout.light ? paperVars(paperTheme(applied.theme)) : undefined);

  /** The dot grid: one tile of it (diagram-grid.ts) repeated over an element larger than the stage, at one zoom;
   *  panning and zooming move and scale it, and it is drawn again when the view rests. Scaled too far meanwhile, it
   *  hides rather than being drawn again in the middle of a zoom. */
  let gridAt = $state<number>();
  settleZoom(
    () => gridAt,
    (at) => (gridAt = at),
  );
  const gridZoom = $derived(gridAt ?? view.zoom);
  /** The grid's color, read from its element (the theme's or the paper's) as they change. */
  let grid = $state<HTMLElement>();
  let gridColor = $state("");
  $effect(() => {
    void [applied.theme, paper];
    if (grid) gridColor = getComputedStyle(grid).color;
  });
  const tile = $derived(gridTile(gridZoom, gridColor));
  const gridWidth = $derived(gridBox(camera, gridZoom).width);
  const gridHeight = $derived(gridBox(camera, gridZoom).height);
  const place = $derived(gridPlace(view, gridZoom));
  const gridAway = $derived(gridStale(view.zoom, gridZoom));

  /** The zoom the picture is rasterized at: the view's, once it has stayed a moment (and at once for a new picture).
   *  Between, the picture is scaled by a transform, which the compositor does without drawing it again; so moving and
   *  zooming cost no painting, and the picture is sharp again when the view rests. */
  let rest = $state<number>();
  settleZoom(
    () => rest,
    (at) => (rest = at),
  );
  $effect(() => {
    void shown?.url;
    rest = untrack(() => view.zoom);
  });

  /** An empty diagram: it reads, and draws nothing. */
  const blank = $derived(
    !ws.problem && (ws.empty || (!!ws.picture && !ws.picture.scene.shapes.length)),
  );
  /** The view has left the diagram: none of it is on the canvas. */
  const away = $derived.by(() => {
    const scene = ws.picture?.scene;
    if (!scene?.shapes.length || !camera.width) return false;
    return awayFromView(boxOnScreen(view, scene.bounds), camera.width, camera.height);
  });
  /** The picture on show under an error is of another type than the source says now. */
  const earlier = $derived(
    !!ws.problem && !!ws.picture && !!ws.pictures.kind && ws.picture.kind !== ws.pictures.kind,
  );
  const firstPiece = $derived(ed.palette?.shapes[0]?.name.toLowerCase() ?? "part");
</script>

<svelte:window onkeydown={key} onkeydowncapture={escapeKey} onkeyup={release} />

<svelte:document
  oncopy={(e) => focused() && ed.copyTo(e, false)}
  oncut={(e) => focused() && ed.copyTo(e, true)}
  onpaste={(e) => focused() && ed.pasteFrom(e, g.pointer)}
/>

<main class="canvas" class:stale={!!ws.problem} class:paper={!!paper} style={paper}>
  {#if ws.layout.grid}
    <div
      class="layer grid"
      class:away={gridAway}
      bind:this={grid}
      style:width="{gridWidth}px"
      style:height="{gridHeight}px"
      style:transform="translate({place.x}px, {place.y}px) scale({place.scale})"
      style:background-image={gridColor ? tile.url : undefined}
      style:background-size="{tile.size}px {tile.size}px"
      style:background-position="{tile.offset}px {tile.offset}px"
    ></div>
  {/if}
  {#if shown && !ws.empty}
    {@const at = toScreen(view, shown.scene.bounds)}
    {@const drawn = rest ?? view.zoom}
    <img
      class="layer picture"
      src={shown.url}
      alt=""
      draggable="false"
      style:width="{shown.scene.bounds.width * drawn}px"
      style:height="{shown.scene.bounds.height * drawn}px"
      style:transform="translate({at.x}px, {at.y}px) scale({view.zoom / drawn})"
    />
  {/if}
  {#if blank}
    <div class="empty">
      <strong>An empty diagram</strong>
      {#if ed.uml}
        <span>Click a shape on the left, or double-click here, to add the first {firstPiece}.</span>
      {:else if ws.textual}
        <span>Type in the source, or add a snippet from the left.</span>
      {:else}
        <span>Drag a shape here from the left, or double-click for an agent.</span>
        <span class="note"
          >Positions are written into the source as <code>@x,y</code>; without them the layout is
          automatic.</span
        >
      {/if}
    </div>
  {/if}
  {#if ws.textual && !ws.problem}<div class="preview-label">Preview</div>{/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
  <div
    class="stage"
    tabindex="0"
    aria-label="Diagram canvas"
    style:cursor={g.cursor}
    bind:this={ws.stage}
    bind:clientWidth={camera.width}
    bind:clientHeight={camera.height}
    {@attach camera.wheel}
    onpointerdown={g.down}
    onpointermove={g.move}
    onpointerup={g.up}
    onpointercancel={g.cancel}
    onpointerleave={g.leave}
    ondblclick={dblclick}
    oncontextmenu={pressMenu}
    ondragstart={(e) => e.preventDefault()}
    onblur={() => (ws.space = false)}
  >
    {#if ws.model}<DiagramOverlay {ws} />{/if}
    {#if ws.renaming}
      {@const r = ws.renaming}
      <DiagramRename
        value={r.value}
        on={boxOnScreen(view, r.box)}
        size={r.size * view.zoom}
        weight={r.weight}
        room={{ width: camera.width, height: camera.height }}
        ondone={ws.endRename}
      />
    {/if}
  </div>

  <!-- Outside the stage, whose pointer capture would take their clicks. -->
  {#if ws.problem && !ws.empty}
    {@const problem = ws.problem}
    <button class="banner" type="button" onclick={() => ws.host.onproblem(problem.line)}>
      The source has an error{problem.line ? ` on line ${problem.line}` : ""}.{ws.picture
        ? ` Showing the last valid diagram${earlier ? " of the previous type" : ""}.`
        : ""}
    </button>
  {/if}
  {#if away}
    <button class="away" class:low={!!ws.problem} type="button" onclick={ws.fit}>
      <Icon icon={ICONS.fit} /><span>Back to the diagram</span>
    </button>
  {/if}
  <DiagramMinimap {ws} />
</main>

<style>
  /* The page is the diagram's own color, so the picture lies on it seamlessly. */
  .canvas {
    position: relative;
    grid-area: stage;
    min-width: 0;
    min-height: 0;
    overflow: clip;
    background: var(--c-surface);
  }
  .layer {
    position: absolute;
    pointer-events: none;
    user-select: none;
  }
  /* The grid and the picture move by transforms, on layers of their own: the compositor moves them, nothing is drawn. */
  .grid {
    top: 0;
    left: 0;
    transform-origin: 0 0;
    will-change: transform;
    color: color-mix(in srgb, var(--c-foreground) 16%, var(--c-surface));
  }
  .grid.away {
    visibility: hidden;
  }
  .picture {
    top: 0;
    left: 0;
    max-width: none;
    transform-origin: 0 0;
    will-change: transform;
  }
  .stale .picture {
    opacity: 0.6;
  }
  .stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
    outline: none;
    touch-action: none;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: center;
    justify-content: center;
    padding: var(--space-7);
    color: var(--d-text-2);
    text-align: center;
    pointer-events: none;
  }
  .empty strong {
    color: var(--d-text);
    font-size: var(--text-lg);
    font-weight: 600;
  }
  .empty .note {
    margin-top: var(--space-4);
    color: var(--d-text-3);
  }
  .preview-label {
    position: absolute;
    top: var(--space-5);
    left: var(--space-5);
    padding: var(--space-1) var(--space-4);
    border: var(--border-width) solid var(--d-line);
    border-radius: var(--radius-sm);
    background: var(--d-panel);
    color: var(--d-text-2);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    pointer-events: none;
  }
  .banner,
  .away {
    position: absolute;
    top: var(--space-5);
    left: 50%;
    height: var(--control-md);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-popover);
    translate: -50% 0;
  }
  .banner {
    max-width: calc(100% - var(--space-7));
    padding: 0 var(--space-5);
    overflow: hidden;
    border: var(--border-width) solid color-mix(in srgb, var(--d-danger) 40%, var(--d-line));
    background: color-mix(in srgb, var(--d-danger) 10%, var(--d-raised));
    color: var(--d-danger);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .away {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    padding: 0 10px;
    border: var(--border-width) solid var(--d-line-strong);
    background: var(--d-raised);
    color: var(--d-text);
  }
  .away:hover {
    background: var(--d-hover);
  }
  .away.low {
    top: 48px;
  }
</style>
