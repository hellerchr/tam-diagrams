<!-- The diagram editor's status bar (DiagramView.svelte), as in tam-diagrams' editor (statusbar.ts): the hint for what
     the pointer can do now (diagram-status.ts), the source's problem or the overlaps the notation does not allow (a click
     shows where), what is selected, where the pointer is in the diagram, how the diagram is laid out (a menu: Manual
     positions or Auto layout) and the Snap switch, the Light canvas switch, and the zoom: out, the level as a field to type a percentage into
     with the menu of the usual ones and the fits, and in. -->
<script lang="ts">
  import { hasPlaces } from "../../src/uml-places.ts";
  import { openMenu } from "../lib/overlays.svelte.ts";
  import Icon from "../ui/Icon.svelte";
  import { layoutItems, zoomItems } from "./diagram-bar-view.ts";
  import { ICONS } from "./diagram-icons.ts";
  import { count, hintText, modeTip, selectionText, typedZoom } from "./diagram-status.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";

  let { ws }: { ws: Workbench } = $props();
  const ed = $derived(ws.ed);
  const layout = $derived(ws.layout);

  const elements = $derived(ed.selectedIds().length);
  const wires = $derived(ed.selection.length - elements);
  const hint = $derived(
    hintText({
      problem: !!ws.problem,
      picture: !!ws.picture,
      structural: !!ws.model && !!ed.uml,
      editable: !!ws.model && !ed.uml,
      plural: `${ws.current?.name ?? "Diagram"}s`,
      doing: ws.g.doing,
      tool: ws.tool,
      sticky: ws.sticky,
      elements,
      wires,
    }),
  );
  const overlaps = $derived(ed.overlaps.length);
  /** Whether the diagram stands where the source places it: by hand, rather than laid out. */
  const placed = $derived(
    ed.uml
      ? hasPlaces(ws.source)
      : [...(ed.model?.diagram.nodes.values() ?? [])].some((node) => !!node.at),
  );
  const pointer = $derived(ws.g.pointer);
  const zoom = $derived(Math.round(ws.camera.view.zoom * 100));

  /** The status bar's menu that is open. */
  let open = $state<"mode" | "zoom">();
  /** Opens a menu above its button: a press opens it, a click from the keyboard too, with its first row lit. */
  function menu(which: "mode" | "zoom", e: MouseEvent & { currentTarget: HTMLElement }) {
    if (e.type === "pointerdown" ? e.button !== 0 : e.detail !== 0) return;
    e.preventDefault();
    const items = which === "mode" ? layoutItems(ws, placed) : zoomItems(ws);
    const first = e.type !== "pointerdown";
    openMenu(e.currentTarget, items, {
      above: true,
      right: which === "zoom",
      first,
      closed: () => (open = undefined),
    });
    open = which;
  }

  let zoomField = $state<HTMLInputElement>();
  let typing = $state(false);
  let typed = $state("");

  /** Shows where the problem is: the source's line, or the elements that lie on each other. */
  function showProblem() {
    if (ws.problem) return ws.host.onproblem(ws.problem.line);
    const pairs = ed.model && ed.edits ? ed.edits.overlaps(ed.model) : [];
    const ids = [...new Set(pairs.flat())];
    if (!ids.length) return;
    ed.selection = ids.map((id) => ({ type: "element", id }));
    ws.fitSelection();
  }

  function zoomKey(e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    const to = e.key === "Enter" ? typedZoom(typed) : undefined;
    if (to) ws.zoomTo(to);
    // Back to the canvas, with the zoom as it is now.
    ws.stage?.focus({ preventScroll: true });
  }
</script>

<footer class="status">
  <span class="hint">{hint}</span>
  {#if ws.problem || overlaps}
    <button
      class="status-button problem"
      class:warning={!ws.problem}
      title={ws.problem
        ? ws.problem.message.replace(/`/g, "")
        : "Elements lie on each other. TAM places all elements apart."}
      onclick={showProblem}
    >
      <Icon icon={ICONS.warning} size={12} /><span
        >{ws.problem ? "1 problem" : `TAM: ${count(overlaps, "overlap")}`}</span
      >
    </button>
  {/if}
  {#if elements || wires}<span class="item">{selectionText(elements, wires)}</span>{/if}
  {#if pointer && !layout.narrow}<span class="item position"
      >{Math.round(pointer.x)}, {Math.round(pointer.y)}</span
    >{/if}
  {#if ws.model}
    <div class="item modes">
      <button
        class="status-button"
        aria-haspopup="menu"
        aria-expanded={open === "mode"}
        title={modeTip(placed, !!ed.uml)}
        onpointerdown={(e) => menu("mode", e)}
        onclick={(e) => menu("mode", e)}
      >
        {placed ? "Manual positions" : "Auto layout"}
      </button>
      <button
        class="status-button"
        aria-pressed={layout.snap}
        title="Snap to the grid and to other elements. Alt turns it off while dragging."
        onclick={() => (layout.snap = !layout.snap)}
      >
        <Icon icon={ICONS.snap} size={12} /><span>Snap</span>
      </button>
    </div>
  {/if}
  <div class="item">
    <button
      class="status-button"
      aria-pressed={layout.light}
      title="Light canvas: the diagram on white, whatever the theme"
      onclick={() => (layout.light = !layout.light)}
    >
      <Icon icon={ICONS.sun} size={12} /><span>Light</span>
    </button>
  </div>
  <div class="item zooms">
    <button class="status-button square" title="Zoom out (−)" onclick={() => ws.zoomStep(false)}
      ><Icon icon={ICONS.minus} size={12} /></button
    >
    <span class="zoom-box">
      <input
        class="zoom-field"
        type="text"
        inputmode="numeric"
        spellcheck="false"
        title="Zoom: type a percentage"
        aria-label="Zoom"
        bind:this={zoomField}
        value={typing ? typed : `${zoom}%`}
        oninput={(e) => (typed = e.currentTarget.value)}
        onfocus={() => (
          (typing = true),
          (typed = `${zoom}%`),
          queueMicrotask(() => zoomField?.select())
        )}
        onblur={() => (typing = false)}
        onkeydown={zoomKey}
      />
      <button
        class="status-button zoom"
        aria-haspopup="menu"
        aria-expanded={open === "zoom"}
        title="Zoom levels and fits"
        onpointerdown={(e) => menu("zoom", e)}
        onclick={(e) => menu("zoom", e)}
      >
        <Icon icon={ICONS.chevron} size={12} />
      </button>
    </span>
    <button class="status-button square" title="Zoom in (+)" onclick={() => ws.zoomStep(true)}
      ><Icon icon={ICONS.plus} size={12} /></button
    >
  </div>
</footer>

<style>
  .status {
    grid-area: status;
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0 var(--space-2) 0 var(--space-5);
    overflow: hidden;
    border-top: var(--border-width) solid var(--d-line);
    background: var(--d-panel-2);
    color: var(--d-text-2);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .hint {
    flex: 1;
    min-width: 0;
    margin-right: var(--space-4);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* The parts stand in groups with a line between them. */
  .item,
  .problem {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 16px;
    padding: 0 var(--space-4);
    border-left: var(--border-width) solid var(--d-line-strong);
    font-variant-numeric: tabular-nums;
  }
  .position {
    min-width: 84px;
    justify-content: flex-end;
  }
  .zooms {
    padding-right: 0;
  }
  .status-button {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 20px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    white-space: nowrap;
  }
  .status-button:hover {
    background: var(--d-hover);
  }
  .status-button[aria-pressed="true"],
  .status-button[aria-expanded="true"] {
    background: var(--d-accent-soft);
    color: var(--d-accent-text);
  }
  .status-button:focus-visible,
  .zoom-field:focus-visible {
    outline: 2px solid var(--d-accent);
    outline-offset: 1px;
  }
  .square {
    width: 20px;
    padding: 0;
  }
  .status-button.problem {
    height: 20px;
    border-radius: 0;
    color: var(--d-danger);
  }
  .status-button.problem.warning {
    color: var(--d-warning);
  }
  /* The zoom: a number to type over, and beside it the list of the usual ones. */
  .zoom-box {
    display: flex;
    align-items: center;
  }
  .zoom-field {
    width: 44px;
    height: 20px;
    padding: 0 var(--space-1);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .zoom-field:hover {
    background: var(--d-hover);
  }
  .zoom-field:focus {
    border-color: var(--d-accent);
    outline: none;
    background: var(--d-field);
    color: var(--d-text);
  }
  .status-button.zoom {
    width: 16px;
    padding: 0;
  }
</style>
