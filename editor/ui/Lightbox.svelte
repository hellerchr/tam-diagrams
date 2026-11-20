<!-- A picture over the window, to look at closely: it opens fitted to the window, a drag pans it, the wheel or a pinch
     zooms at the pointer, a double click zooms in there (or back to fit), and the bar sets the zoom (−, a typed
     percentage, +, fit, 1:1). Keys: + − 0 (fit) 1 (1:1), Esc closes; so does a click beside the picture. Moving only
     changes a transform, so panning and zooming never lay anything out. The math is lib/zoom.ts. -->
<script lang="ts">
  import { Maximize, X, ZoomIn, ZoomOut } from "lucide";
  import { center, fit, parsePercent, type View, wheelFactor, zoomAt } from "../lib/zoom.ts";
  import Button from "./Button.svelte";

  let { src, onclose }: { src: string; onclose: () => void } = $props();

  const MARGIN = 48;
  const STEP = 1.25;
  let el = $state<HTMLDivElement>();
  let width = $state(0);
  let height = $state(0);
  let picture = $state<{ width: number; height: number }>();
  let view = $state<View>({ x: 0, y: 0, zoom: 1 });
  /** Fitted until the person pans or zooms: a resized window fits it again. */
  let fitted = $state(true);
  let typing = $state<string>();
  // A vector picture (a diagram) may grow to fill the window; a photo or screenshot opens at most at its own size.
  const vector = $derived(/^data:image\/svg|\.svg(\?|$)/i.test(src));

  function fitView() {
    if (!picture) return;
    const best = fit(picture, { width, height }, MARGIN);
    view = vector || best.zoom <= 1 ? best : center(picture, { width, height }, 1);
    fitted = true;
  }
  const set = (next: View) => ((view = next), (fitted = false));
  const zoomBy = (factor: number, px = width / 2, py = height / 2) =>
    set(zoomAt(view, view.zoom * factor, px, py));
  const actual = () => set(zoomAt(view, 1, width / 2, height / 2));

  function loaded(event: Event) {
    const img = event.currentTarget as HTMLImageElement;
    picture = { width: img.naturalWidth || 800, height: img.naturalHeight || 600 };
    fitView();
  }

  $effect(() => {
    void [width, height];
    if (fitted) fitView();
  });

  // The wheel listener is not passive, so the page behind never scrolls.
  $effect(() => {
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      zoomBy(wheelFactor(e), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el?.removeEventListener("wheel", wheel);
  });

  let drag: { id: number; x: number; y: number; moved: boolean } | undefined;
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    el?.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  }
  function move(e: PointerEvent) {
    if (drag?.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag = { ...drag, x: e.clientX, y: e.clientY, moved: true };
    set({ ...view, x: view.x + dx, y: view.y + dy });
  }
  function up(e: PointerEvent) {
    if (drag?.id !== e.pointerId) return;
    const click = !drag.moved && e.target === el;
    drag = undefined;
    if (click) onclose();
  }
  function dblclick(e: MouseEvent) {
    if (!fitted) return fitView();
    const rect = el!.getBoundingClientRect();
    zoomBy(2, e.clientX - rect.left, e.clientY - rect.top);
  }

  const keys: Record<string, () => void> = {
    Escape: () => onclose(),
    "+": () => zoomBy(STEP),
    "=": () => zoomBy(STEP),
    "-": () => zoomBy(1 / STEP),
    "0": fitView,
    "1": actual,
  };
  function keydown(e: KeyboardEvent) {
    const action = typing === undefined || e.key === "Escape" ? keys[e.key] : undefined;
    if (!action || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  }

  function typed() {
    const zoom = typing === undefined ? undefined : parsePercent(typing);
    typing = undefined;
    if (zoom) set(zoomAt(view, zoom, width / 2, height / 2));
  }
</script>

<svelte:window onkeydown={keydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="lightbox"
  bind:this={el}
  bind:clientWidth={width}
  bind:clientHeight={height}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={() => (drag = undefined)}
>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <img
    {src}
    alt="Full size"
    draggable="false"
    class:ready={picture}
    style:width="{picture?.width}px"
    style:transform="translate({view.x}px, {view.y}px) scale({view.zoom})"
    onload={loaded}
    ondblclick={dblclick}
  />
</div>
<div class="popover zoombar" role="toolbar" aria-label="Zoom">
  <Button
    variant="ghost"
    size="sm"
    icon={ZoomOut}
    title="Zoom out (−)"
    onclick={() => zoomBy(1 / STEP)}
  />
  <input
    class="percent"
    aria-label="Zoom"
    value={typing ?? `${Math.round(view.zoom * 100)}%`}
    onfocus={(e) => ((typing = e.currentTarget.value), e.currentTarget.select())}
    oninput={(e) => (typing = e.currentTarget.value)}
    onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    onblur={typed}
  />
  <Button
    variant="ghost"
    size="sm"
    icon={ZoomIn}
    title="Zoom in (+)"
    onclick={() => zoomBy(STEP)}
  />
  <Button
    variant="ghost"
    size="sm"
    icon={Maximize}
    title="Fit (0)"
    active={fitted}
    onclick={fitView}
  />
  <Button variant="ghost" size="sm" title="Actual size (1)" onclick={actual}>1:1</Button>
  <Button variant="ghost" size="sm" icon={X} title="Close (Esc)" onclick={onclose} />
</div>

<style>
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: var(--z-dialog);
    overflow: hidden;
    background: color-mix(in srgb, var(--c-canvas) 85%, transparent);
    cursor: zoom-out;
    touch-action: none;
    animation: var(--enter-fade);
  }
  .lightbox:active {
    cursor: grabbing;
  }
  img {
    position: absolute;
    top: 0;
    left: 0;
    max-width: none;
    height: auto;
    transform-origin: 0 0;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-popover);
    cursor: grab;
    user-select: none;
    visibility: hidden;
  }
  img.ready {
    visibility: visible;
  }
  .zoombar {
    position: fixed;
    z-index: var(--z-dialog);
    bottom: var(--space-6);
    left: 0;
    right: 0;
    width: fit-content;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    animation: var(--enter-fade);
  }
  .percent {
    width: 6ch;
    height: var(--control-sm);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--c-foreground);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .percent:focus {
    background: var(--c-selected);
    border-radius: var(--radius-sm);
  }
</style>
