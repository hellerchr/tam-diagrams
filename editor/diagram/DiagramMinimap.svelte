<!-- The minimap at the foot of the diagram canvas (DiagramCanvas.svelte), as tam-diagrams' old editor had it
     (editor/minimap.ts): the whole diagram small, its containers outlined and the rest filled, with the part on show
     framed (a box over the drawing, so a pan only moves it). It shows while the diagram reaches beyond the canvas, unless the View menu turned it off; a press or a drag
     on it brings that point to the middle of the canvas. -->
<script lang="ts">
  import type { Box } from "./diagram-hit.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";

  const WIDTH = 180;
  const HEIGHT = 120;
  const PAD = 8;

  let { ws }: { ws: Workbench } = $props();
  const camera = $derived(ws.camera);
  let canvas = $state<HTMLCanvasElement>();
  let dragging = $state(false);

  /** The part of the diagram on show. */
  const seen = $derived.by((): Box | undefined => {
    const { width, height, view } = camera;
    if (!width || !height) return undefined;
    return {
      x: -view.x / view.zoom,
      y: -view.y / view.zoom,
      width: width / view.zoom,
      height: height / view.zoom,
    };
  });
  const inside = (a: Box, b: Box) =>
    a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
  const scene = $derived((ws.pictures.preview ?? ws.picture)?.scene);
  /** How the diagram maps onto the minimap: the scale and the diagram's point at its corner. While the minimap is
   *  dragged it stays as it is, so the frame follows the pointer steadily. */
  let kept = { scale: 1, x: 0, y: 0 };
  const map = $derived.by(() => {
    if (dragging || !scene) return kept;
    const b = scene.bounds;
    const scale = Math.min((WIDTH - 2 * PAD) / b.width, (HEIGHT - 2 * PAD) / b.height);
    return (kept = {
      scale,
      x: b.x + b.width / 2 - WIDTH / 2 / scale,
      y: b.y + b.height / 2 - HEIGHT / 2 / scale,
    });
  });
  const shown = $derived(
    ws.layout.minimap &&
      !!scene?.bounds.width &&
      !!seen &&
      (dragging || !inside(scene.bounds, seen)) &&
      !ws.empty,
  );

  /** A box of the diagram on the minimap: left, top, width and height. */
  const on = (box: Box) =>
    [
      (box.x - map.x) * map.scale,
      (box.y - map.y) * map.scale,
      box.width * map.scale,
      box.height * map.scale,
    ] as const;

  // The diagram, drawn again only as it or its map changes: a pan moves the frame alone.
  $effect(() => {
    if (!shown || !canvas || !scene) return;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== WIDTH * ratio)
      [canvas.width, canvas.height] = [WIDTH * ratio, HEIGHT * ratio];
    const context = canvas.getContext("2d")!;
    const style = getComputedStyle(canvas);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.lineWidth = 1;
    context.strokeStyle = style.getPropertyValue("--d-line-strong");
    context.fillStyle = style.getPropertyValue("--d-text-3");
    for (const shape of scene.shapes) {
      const [left, top, wide, high] = on(shape.box);
      if (wide < 1 || high < 1) continue;
      if (shape.container) context.strokeRect(left + 0.5, top + 0.5, wide, high);
      else context.fillRect(left, top, Math.max(2, wide), Math.max(2, high));
    }
  });
  /** The part on show, framed on the minimap. */
  const frame = $derived(seen && on(seen));

  /** The diagram's point under the pointer comes to the middle of the canvas. */
  function go(e: PointerEvent) {
    const rect = canvas!.getBoundingClientRect();
    const at = {
      x: (e.clientX - rect.left) / map.scale + map.x,
      y: (e.clientY - rect.top) / map.scale + map.y,
    };
    const { view } = camera;
    camera.pan(
      view,
      camera.width / 2 - (at.x * view.zoom + view.x),
      camera.height / 2 - (at.y * view.zoom + view.y),
    );
  }
</script>

<div
  class="minimap"
  aria-hidden="true"
  hidden={!shown}
  onpointerdown={(e) => {
    if (e.button !== 0) return;
    dragging = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    go(e);
  }}
  onpointermove={(e) => dragging && go(e)}
  onpointerup={() => (dragging = false)}
  onpointercancel={() => (dragging = false)}
>
  <canvas bind:this={canvas}></canvas>
  {#if frame}
    {@const [left, top, wide, high] = frame}
    <div
      class="seen"
      style:width="{wide}px"
      style:height="{high}px"
      style:transform="translate({left}px, {top}px)"
    ></div>
  {/if}
</div>

<style>
  .minimap {
    position: absolute;
    overflow: hidden;
    right: var(--space-5);
    bottom: var(--space-5);
    width: 180px;
    height: 120px;
    border: var(--border-width) solid var(--d-line-strong);
    border-radius: var(--radius-sm);
    background: var(--d-panel);
    box-shadow: var(--shadow-popover);
    cursor: pointer;
    touch-action: none;
  }
  .minimap[hidden] {
    display: none;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .seen {
    position: absolute;
    top: 0;
    left: 0;
    border: 1.5px solid var(--d-accent);
    background: color-mix(in srgb, var(--d-accent) 12%, transparent);
    pointer-events: none;
  }
</style>
